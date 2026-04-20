import base64
import copy
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import timedelta
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import OrderedDict
from threading import Lock

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET
from django.views.decorators.http import require_POST
from litellm import RateLimitError, completion

from .models import CommunityMessage

MODEL_REGISTRY = {
	'gemini-2.5-pro': {'provider': 'google', 'model': 'gemini/gemini-2.5-pro'},
	'gemini-2.5-flash': {'provider': 'google', 'model': 'gemini/gemini-2.5-flash'},
	'gemini-2.0-flash': {'provider': 'google', 'model': 'gemini/gemini-2.0-flash'},
	'gpt-5': {'provider': 'openai', 'model': 'gpt-5'},
	'gpt-4o': {'provider': 'openai', 'model': 'gpt-4o'},
	'claude-4': {'provider': 'anthropic', 'model': 'claude-4'},
	'claude-3.5': {'provider': 'anthropic', 'model': 'claude-3.5'},
	'deepseek-chat': {'provider': 'deepseek', 'model': 'deepseek-chat'},
	'hf-llama3-8b': {
		'provider': 'huggingface',
		'model': 'huggingface/meta-llama/Meta-Llama-3-8B-Instruct',
	},
}

# Community chat moderation: messages containing these terms are only visible to the author.
COMMUNITY_BLOCKED_WORDS = [
	"fuck",
]

PROVIDER_KEYS = {
	'openai': os.getenv('OPENAI_API_KEY'),
	'anthropic': os.getenv('ANTHROPIC_API_KEY'),
	'google': (
		os.getenv('GOOGLE_GENERATIVE_AI_API_KEY')
		or os.getenv('GOOGLE_API_KEY')
		or os.getenv('gemini_api_key')
	),
	'huggingface': os.getenv('HUGGINGFACE_API_KEY'),
	'groq': os.getenv('GROQ_API_KEY') or os.getenv('groq_api_key'),
	'deepseek': os.getenv('DEEPSEEK_API_KEY'),
}

VISION_PROVIDERS = {'openai', 'google', 'anthropic'}
WHISPER_MODEL = os.getenv('WHISPER_MODEL', 'distil-whisper/distil-small.en')
GROQ_WHISPER_MODEL = os.getenv('GROQ_WHISPER_MODEL', 'whisper-large-v3')
MAX_HISTORY_MESSAGES = int(os.getenv('MAX_CHAT_HISTORY_MESSAGES', '12'))
MAX_STORED_MESSAGES_PER_CONVERSATION = int(os.getenv('MAX_STORED_MESSAGES_PER_CONVERSATION', '200'))
MAX_IN_MEMORY_CONVERSATIONS = int(os.getenv('MAX_IN_MEMORY_CONVERSATIONS', '500'))
TEST_GENERATION_MODEL = os.getenv('TEST_GENERATION_MODEL', 'gemini-2.5-flash')
MAX_TEST_QUESTIONS = int(os.getenv('MAX_TEST_QUESTIONS', '30'))
MAX_CODING_TEST_CASES = int(os.getenv('MAX_CODING_TEST_CASES', '20'))
CODE_RUN_TIMEOUT_SECONDS = int(os.getenv('CODE_RUN_TIMEOUT_SECONDS', '8'))
MAX_DOCUMENT_TEXT_CHARS = int(os.getenv('MAX_DOCUMENT_TEXT_CHARS', '30000'))
GOOGLE_OAUTH_CLIENT_ID = (
	os.getenv('GOOGLE_OAUTH_CLIENT_ID')
	or os.getenv('GOOGLE_CLIENT_ID')
	or os.getenv('clint_id')
	or ''
).strip()
GOOGLE_OAUTH_CLIENT_SECRET = (
	os.getenv('GOOGLE_OAUTH_CLIENT_SECRET')
	or os.getenv('GOOGLE_CLIENT_SECRET')
	or os.getenv('secret_key')
	or ''
).strip()
_google_oauth_redirect_uris_raw = os.getenv('GOOGLE_OAUTH_REDIRECT_URIS', '').strip()
if _google_oauth_redirect_uris_raw:
	GOOGLE_OAUTH_REDIRECT_URIS = [
		uri.strip().rstrip('/')
		for uri in _google_oauth_redirect_uris_raw.split(',')
		if uri.strip()
	]
else:
	fallback_redirect = (os.getenv('GOOGLE_OAUTH_REDIRECT_URI') or 'http://localhost:5173').strip().rstrip('/')
	GOOGLE_OAUTH_REDIRECT_URIS = [fallback_redirect] if fallback_redirect else []


def _resolve_google_redirect_uri(request=None):
	if not GOOGLE_OAUTH_REDIRECT_URIS:
		return 'postmessage'

	request_origin = ''
	if request is not None:
		request_origin = str(request.headers.get('Origin') or '').strip().rstrip('/')

	if request_origin:
		matches = [
			redirect_uri
			for redirect_uri in GOOGLE_OAUTH_REDIRECT_URIS
			if redirect_uri == request_origin or redirect_uri.startswith(f'{request_origin}/')
		]
		if matches:
			# Prefer path-based callbacks like /app when available.
			matches.sort(key=len, reverse=True)
			return matches[0]

	return GOOGLE_OAUTH_REDIRECT_URIS[0]


def _is_allowed_google_redirect_uri(redirect_uri):
	normalized = str(redirect_uri or '').strip().rstrip('/')
	if not normalized:
		return False
	return normalized in GOOGLE_OAUTH_REDIRECT_URIS

# Temporary chat store kept in process memory only; it is cleared on server restart.
_CONVERSATION_STORE = OrderedDict()
_CONVERSATION_LOCK = Lock()
_GOOGLE_KEY_ROTATION_LOCK = Lock()
_GOOGLE_KEY_ROTATION_INDEX = 0


def _load_google_api_keys():
	keys = []
	for env_name in [
		'GOOGLE_GENERATIVE_AI_API_KEY',
		'GOOGLE_API_KEY',
		'gemini_api_key',
	]:
		value = (os.getenv(env_name) or '').strip()
		if value:
			keys.append(value)

	for i in range(1, 11):
		for env_name in [
			f'GOOGLE_GENERATIVE_AI_API_KEY{i}',
			f'GOOGLE_API_KEY{i}',
			f'gemini_api_key{i}',
		]:
			value = (os.getenv(env_name) or '').strip()
			if value:
				keys.append(value)

	# Keep insertion order while removing duplicates.
	return list(dict.fromkeys(keys))


def _get_rotated_google_keys():
	global _GOOGLE_KEY_ROTATION_INDEX
	keys = _load_google_api_keys()
	if not keys:
		return []

	with _GOOGLE_KEY_ROTATION_LOCK:
		start = _GOOGLE_KEY_ROTATION_INDEX % len(keys)
		_GOOGLE_KEY_ROTATION_INDEX = (_GOOGLE_KEY_ROTATION_INDEX + 1) % len(keys)

	return keys[start:] + keys[:start]


def _complete_with_google_fallback(request_kwargs, google_keys):
	last_error = None
	for api_key in google_keys:
		try:
			return completion(
				**request_kwargs,
				api_key=api_key,
				google_api_key=api_key,
			)
		except RateLimitError as exc:
			last_error = exc
			continue
		except Exception as exc:
			# Rotate to next key for key-specific failures (leaked/invalid/denied/quota).
			error_text = str(exc).lower()
			should_retry_with_next_key = any(
				needle in error_text
				for needle in [
					'permission_denied',
					'api key was reported as leaked',
					'invalid api key',
					'api_key_invalid',
					'api key not valid',
					'quota',
					'403',
					'429',
				]
			)
			if should_retry_with_next_key:
				last_error = exc
				continue
			raise

	if last_error:
		raise last_error
	raise RateLimitError('No usable Google API key found for this request.')


def _get_model_config(model_id):
	config = MODEL_REGISTRY.get(model_id)
	if not config:
		return None
	provider = config['provider']
	google_keys = _get_rotated_google_keys() if provider == 'google' else []
	selected_key = google_keys[0] if google_keys else PROVIDER_KEYS.get(provider)
	return {
		**config,
		'api_key': selected_key,
		'api_keys': google_keys,
	}


def _build_content(message, images):
	content = []
	if message:
		content.append({'type': 'text', 'text': message})
	for img in images:
		url = (img or {}).get('dataUrl') or (img or {}).get('url')
		if url:
			content.append({'type': 'image_url', 'image_url': {'url': url}})
	return content


def _decode_data_url(data_url):
	if not data_url or not data_url.startswith('data:') or ',' not in data_url:
		return None, None
	header, b64 = data_url.split(',', 1)
	if ';base64' not in header:
		return None, None
	mime = header[5:].split(';', 1)[0] or 'application/octet-stream'
	try:
		return base64.b64decode(b64), mime
	except (ValueError, TypeError):
		return None, None


def _decode_json_response(raw_bytes):
	try:
		return json.loads((raw_bytes or b'').decode('utf-8'))
	except json.JSONDecodeError:
		return {}


def _post_form_json(url, payload):
	body = urllib.parse.urlencode(payload).encode('utf-8')
	headers = {'Content-Type': 'application/x-www-form-urlencoded'}
	request = urllib.request.Request(url, data=body, headers=headers, method='POST')
	with urllib.request.urlopen(request, timeout=25) as response:
		return _decode_json_response(response.read())


def _get_json(url, headers=None):
	request = urllib.request.Request(url, headers=headers or {}, method='GET')
	with urllib.request.urlopen(request, timeout=25) as response:
		return _decode_json_response(response.read())


def _decode_text_bytes(data):
	if not data:
		return ''
	for encoding in ['utf-8', 'utf-16', 'latin-1']:
		try:
			return data.decode(encoding)
		except UnicodeDecodeError:
			continue
	return data.decode('utf-8', errors='ignore')


def _extract_document_text(document):
	name = str((document or {}).get('name') or 'document').strip() or 'document'
	mime = str((document or {}).get('type') or '').strip().lower()
	data_url = (document or {}).get('dataUrl')
	if not data_url:
		return {'name': name, 'text': '', 'error': 'Missing file data.'}

	data, detected_mime = _decode_data_url(data_url)
	if not data:
		return {'name': name, 'text': '', 'error': 'Invalid file payload.'}

	mime = mime or str(detected_mime or '').lower()
	extension = name.rsplit('.', 1)[-1].lower() if '.' in name else ''

	text_mimes = {
		'text/plain',
		'text/csv',
		'application/json',
		'application/xml',
		'text/xml',
	}
	text_extensions = {'txt', 'md', 'csv', 'json', 'xml', 'log'}

	if mime in text_mimes or extension in text_extensions:
		text = _decode_text_bytes(data).strip()
		return {'name': name, 'text': text, 'error': ''}

	if mime == 'application/pdf' or extension == 'pdf':
		try:
			from pypdf import PdfReader
		except Exception:
			return {
				'name': name,
				'text': '',
				'error': 'PDF parsing dependency is unavailable. Install pypdf to read PDF content.',
			}

		try:
			reader = PdfReader(io.BytesIO(data))
			pages = []
			for page in reader.pages[:20]:
				pages.append(str(page.extract_text() or ''))
			text = '\n'.join(pages).strip()
			if not text:
				return {'name': name, 'text': '', 'error': 'No extractable text found in the PDF.'}
			return {'name': name, 'text': text, 'error': ''}
		except Exception as exc:
			return {'name': name, 'text': '', 'error': f'Could not parse PDF: {exc}'}

	return {
		'name': name,
		'text': '',
		'error': 'Unsupported document type for text extraction.',
	}


def _build_documents_context(documents):
	if not isinstance(documents, list) or not documents:
		return '', []

	sections = []
	errors = []
	total_chars = 0

	for doc in documents[:8]:
		parsed = _extract_document_text(doc)
		name = parsed.get('name') or 'document'
		text = str(parsed.get('text') or '').strip()
		error = str(parsed.get('error') or '').strip()

		if error:
			errors.append(f'{name}: {error}')
			continue

		if not text:
			continue

		remaining = MAX_DOCUMENT_TEXT_CHARS - total_chars
		if remaining <= 0:
			break

		chunk = text[:remaining]
		total_chars += len(chunk)
		sections.append(f'--- {name} ---\n{chunk}')

	return '\n\n'.join(sections).strip(), errors


def _transcribe_audio(audio, api_key):
	data_url = (audio or {}).get('dataUrl')
	if not data_url:
		return None
	data, mime = _decode_data_url(data_url)
	if not data:
		raise ValueError('Invalid audio payload.')
	url = f'https://api-inference.huggingface.co/models/{WHISPER_MODEL}?wait_for_model=true'
	headers = {
		'Authorization': f'Bearer {api_key}',
		'Content-Type': mime or 'application/octet-stream',
	}
	request = urllib.request.Request(url, data=data, headers=headers, method='POST')
	try:
		with urllib.request.urlopen(request, timeout=60) as resp:
			body = resp.read()
			try:
				payload = json.loads(body.decode('utf-8'))
			except json.JSONDecodeError:
				raise ValueError('Audio transcription failed. Check the Hugging Face API key and model access.')
	except urllib.error.HTTPError as exc:
		body = exc.read()
		try:
			payload = json.loads(body.decode('utf-8'))
		except json.JSONDecodeError:
			raise ValueError('Audio transcription failed. Check the Hugging Face API key and model access.')
		if isinstance(payload, dict) and payload.get('error'):
			raise ValueError(payload.get('error'))
		raise ValueError('Audio transcription failed.')
	except urllib.error.URLError as exc:
		raise ValueError(str(exc))
	if isinstance(payload, dict) and payload.get('error'):
		raise ValueError(payload.get('error'))
	if isinstance(payload, dict):
		return payload.get('text')
	return None


def _transcribe_audio_groq(audio, api_key):
	data_url = (audio or {}).get('dataUrl')
	if not data_url:
		return None
	data, mime = _decode_data_url(data_url)
	if not data:
		raise ValueError('Invalid audio payload.')
	try:
		from openai import OpenAI
	except Exception as exc:
		raise ValueError('Groq transcription requires the openai package. Install it in backend requirements.') from exc

	suffix = '.webm' if (mime or '').endswith('webm') else '.wav'
	audio_file = io.BytesIO(data)
	audio_file.name = f'audio{suffix}'

	try:
		client = OpenAI(
			api_key=api_key,
			base_url='https://api.groq.com/openai/v1',
		)
		response = client.audio.transcriptions.create(
			model=GROQ_WHISPER_MODEL,
			file=audio_file,
		)
	except Exception as exc:
		raise ValueError(f'Groq transcription failed: {exc}') from exc

	text = ''
	if hasattr(response, 'text'):
		text = str(getattr(response, 'text') or '').strip()
	elif isinstance(response, dict):
		text = str(response.get('text') or '').strip()

	if not text:
		raise ValueError('Groq transcription returned an empty response.')

	return text


def _transcribe_audio_local(audio):
	data_url = (audio or {}).get('dataUrl')
	if not data_url:
		return None
	data, mime = _decode_data_url(data_url)
	if not data:
		raise ValueError('Invalid audio payload.')
	try:
		from faster_whisper import WhisperModel
	except Exception as exc:
		raise ValueError('Local transcription not available. Install faster-whisper and ffmpeg.') from exc
	model_name = os.getenv('LOCAL_WHISPER_MODEL', 'base')
	# Use a temp file since faster-whisper expects a file path.
	suffix = '.webm' if (mime or '').endswith('webm') else '.wav'
	with tempfile.NamedTemporaryFile(delete=True, suffix=suffix) as tmp:
		tmp.write(data)
		tmp.flush()
		model = WhisperModel(model_name, device='cpu', compute_type='int8')
		segments, _info = model.transcribe(tmp.name)
		text = ''.join(segment.text for segment in segments).strip()
		return text or None


def _ensure_in_memory_conversation(conversation_id):
	conversation_key = str(conversation_id or '').strip() or str(uuid.uuid4())
	now = time.time()
	with _CONVERSATION_LOCK:
		entry = _CONVERSATION_STORE.get(conversation_key)
		if not entry:
			entry = {'messages': [], 'updated_at': now}
			_CONVERSATION_STORE[conversation_key] = entry
		else:
			entry['updated_at'] = now
			_CONVERSATION_STORE.move_to_end(conversation_key)

		while len(_CONVERSATION_STORE) > MAX_IN_MEMORY_CONVERSATIONS:
			_CONVERSATION_STORE.popitem(last=False)

	return conversation_key


def _append_in_memory_message(conversation_id, role, content):
	text = str(content or '').strip()
	if not text:
		return

	now = time.time()
	item = {
		'id': str(uuid.uuid4()),
		'role': role,
		'text': text,
		'created_at': now,
	}

	with _CONVERSATION_LOCK:
		entry = _CONVERSATION_STORE.get(conversation_id)
		if not entry:
			entry = {'messages': [], 'updated_at': now}
			_CONVERSATION_STORE[conversation_id] = entry

		entry['messages'].append(item)
		entry['updated_at'] = now
		if len(entry['messages']) > MAX_STORED_MESSAGES_PER_CONVERSATION:
			entry['messages'] = entry['messages'][-MAX_STORED_MESSAGES_PER_CONVERSATION:]
		_CONVERSATION_STORE.move_to_end(conversation_id)

		while len(_CONVERSATION_STORE) > MAX_IN_MEMORY_CONVERSATIONS:
			_CONVERSATION_STORE.popitem(last=False)


def _get_in_memory_history(conversation_id):
	conversation_key = str(conversation_id or '').strip()
	if not conversation_key:
		return []

	with _CONVERSATION_LOCK:
		entry = _CONVERSATION_STORE.get(conversation_key)
		if not entry:
			return []
		entry['updated_at'] = time.time()
		_CONVERSATION_STORE.move_to_end(conversation_key)
		return copy.deepcopy(entry['messages'])


def _serialize_history(conversation_id):
	items = []
	for message in _get_in_memory_history(conversation_id):
		items.append(
			{
				'id': str(message.get('id') or ''),
				'role': str(message.get('role') or ''),
				'text': str(message.get('text') or ''),
				'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(message.get('created_at') or time.time())),
			}
		)
	return items


def _extract_json_object(text):
	raw = str(text or '').strip()
	if not raw:
		return None

	if raw.startswith('```'):
		raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.IGNORECASE)
		raw = re.sub(r'\s*```$', '', raw)

	start = raw.find('{')
	end = raw.rfind('}')
	if start == -1 or end == -1 or end <= start:
		return None

	try:
		return json.loads(raw[start:end + 1])
	except json.JSONDecodeError:
		return None


def _normalize_generated_questions(payload, count):
	questions = payload.get('questions') if isinstance(payload, dict) else None
	if not isinstance(questions, list):
		return None

	normalized = []
	for idx, item in enumerate(questions[:count]):
		if not isinstance(item, dict):
			continue

		question = str(item.get('question') or item.get('text') or '').strip()
		options = item.get('options')
		correct_index = item.get('correct_index', item.get('answer_index'))

		if not question or not isinstance(options, list) or len(options) != 4:
			continue

		normalized_options = [str(opt or '').strip() for opt in options]
		if any(not opt for opt in normalized_options):
			continue

		try:
			correct_index = int(correct_index)
		except (TypeError, ValueError):
			continue

		if correct_index < 0 or correct_index > 3:
			continue

		normalized.append(
			{
				'id': f'q-{idx + 1}',
				'text': question,
				'options': normalized_options,
				'answerIndex': correct_index,
			}
		)

	if len(normalized) < count:
		return None

	return normalized[:count]


def _build_default_coding_challenge(topic):
	return {
		'title': f'{topic} - Basic Function Practice',
		'description': (
			'Implement a function named solve that returns the sum of all numbers in the input list. '
			'Return 0 for an empty list.'
		),
		'function_name': 'solve',
		'function_signature': 'def solve(nums):',
		'constraints': [
			'1 <= len(nums) <= 10^4 for normal cases',
			'-10^6 <= nums[i] <= 10^6',
			'Target complexity: O(n)',
		],
		'examples': [
			{'input': '[1, 2, 3, 4]', 'output': '10'},
			{'input': '[]', 'output': '0'},
		],
		'starter_code': 'def solve(nums):\n\t# Write your code here\n\treturn 0',
		'visible_test_cases': [
			{'args': [[1, 2, 3, 4]], 'expected': 10},
			{'args': [[5, -2, 1]], 'expected': 4},
		],
		'hidden_test_cases': [
			{'args': [[]], 'expected': 0},
			{'args': [[100, 200, -50]], 'expected': 250},
			{'args': [[-7, -3]], 'expected': -10},
			{'args': [[42]], 'expected': 42},
		],
	}


def _normalize_test_case_list(raw_cases, limit):
	if not isinstance(raw_cases, list):
		return []

	normalized = []
	for item in raw_cases[:limit]:
		if not isinstance(item, dict):
			continue

		args = item.get('args', [])
		kwargs = item.get('kwargs', {})
		expected = item.get('expected', None)

		if kwargs is None:
			kwargs = {}

		if not isinstance(args, list) or not isinstance(kwargs, dict):
			continue

		normalized.append({'args': args, 'kwargs': kwargs, 'expected': expected})

	return normalized


def _normalize_coding_challenge(payload, topic):
	if not isinstance(payload, dict):
		return None

	title = str(payload.get('title') or '').strip() or f'{topic} Coding Challenge'
	description = str(payload.get('description') or '').strip()
	function_name = str(payload.get('function_name') or '').strip()
	function_signature = str(payload.get('function_signature') or '').strip()
	starter_code = str(payload.get('starter_code') or '').rstrip()
	raw_constraints = payload.get('constraints')
	raw_examples = payload.get('examples')
	raw_visible_test_cases = payload.get('visible_test_cases')
	raw_hidden_test_cases = payload.get('hidden_test_cases')
	raw_test_cases = payload.get('test_cases')

	if not description or not function_name or not function_signature:
		return None

	if not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', function_name):
		return None

	if not isinstance(raw_constraints, list):
		raw_constraints = []
	constraints = [str(item or '').strip() for item in raw_constraints if str(item or '').strip()][:8]

	if not isinstance(raw_examples, list):
		raw_examples = []
	examples = []
	for item in raw_examples[:5]:
		if not isinstance(item, dict):
			continue
		example_input = str(item.get('input') or '').strip()
		example_output = str(item.get('output') or '').strip()
		if example_input and example_output:
			examples.append({'input': example_input, 'output': example_output})

	visible_test_cases = _normalize_test_case_list(raw_visible_test_cases, 2)
	hidden_test_cases = _normalize_test_case_list(raw_hidden_test_cases, 4)

	# Backward compatibility for older model responses using a single test_cases array.
	if (not visible_test_cases or not hidden_test_cases) and isinstance(raw_test_cases, list):
		flat_cases = _normalize_test_case_list(raw_test_cases, MAX_CODING_TEST_CASES)
		if not visible_test_cases:
			visible_test_cases = flat_cases[:2]
		if not hidden_test_cases:
			hidden_test_cases = flat_cases[2:6]

	if len(visible_test_cases) != 2 or len(hidden_test_cases) != 4:
		return None

	if not starter_code:
		starter_code = f'{function_signature}\n\t# Write your code here\n\tpass'

	return {
		'title': title,
		'description': description,
		'function_name': function_name,
		'function_signature': function_signature,
		'constraints': constraints,
		'examples': examples,
		'starter_code': starter_code,
		'visible_test_cases': visible_test_cases,
		'hidden_test_cases': hidden_test_cases,
	}


def _normalize_runtime_test_cases(raw_test_cases):
	if not isinstance(raw_test_cases, list):
		return None

	normalized = []
	for item in raw_test_cases[:MAX_CODING_TEST_CASES]:
		if not isinstance(item, dict):
			continue
		args = item.get('args', [])
		kwargs = item.get('kwargs', {})
		is_hidden = bool(item.get('is_hidden', False))
		label = str(item.get('label') or '').strip()
		if kwargs is None:
			kwargs = {}
		if not isinstance(args, list) or not isinstance(kwargs, dict):
			continue
		normalized.append(
			{
				'args': args,
				'kwargs': kwargs,
				'expected': item.get('expected'),
				'is_hidden': is_hidden,
				'label': label,
			}
		)

	if not normalized:
		return None

	return normalized


def _run_code_against_tests(code, function_name, test_cases):
	runner_script = f"""
import json
import traceback

USER_CODE = {code!r}
FUNCTION_NAME = {function_name!r}
TEST_CASES = json.loads({json.dumps(test_cases)!r})

results = []

try:
	namespace = {{}}
	exec(USER_CODE, namespace, namespace)
	target = namespace.get(FUNCTION_NAME)
	if not callable(target):
		raise NameError(f'Function "{{FUNCTION_NAME}}" was not found in submitted code.')

	for index, test_case in enumerate(TEST_CASES, start=1):
		args = test_case.get('args', [])
		kwargs = test_case.get('kwargs', {{}})
		expected = test_case.get('expected')
		is_hidden = bool(test_case.get('is_hidden', False))
		label = str(test_case.get('label') or '').strip()
		try:
			actual = target(*args, **kwargs)
			passed = actual == expected
			results.append({{
				'index': index,
				'passed': passed,
				'is_hidden': is_hidden,
				'label': label,
				'input': {{'args': args, 'kwargs': kwargs}},
				'expected': expected,
				'actual': actual,
				'error': None,
			}})
		except Exception:
			results.append({{
				'index': index,
				'passed': False,
				'is_hidden': is_hidden,
				'label': label,
				'input': {{'args': args, 'kwargs': kwargs}},
				'expected': expected,
				'actual': None,
				'error': traceback.format_exc(),
			}})
except Exception:
	print('__TA_FATAL__' + json.dumps({{'error': traceback.format_exc()}}, default=str))

print('__TA_RESULT__' + json.dumps({{'results': results}}, default=str))
"""

	with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.py', encoding='utf-8') as tmp_file:
		tmp_file.write(runner_script)
		tmp_path = tmp_file.name

	try:
		completed = subprocess.run(
			[sys.executable, tmp_path],
			capture_output=True,
			text=True,
			timeout=CODE_RUN_TIMEOUT_SECONDS,
		)
	except subprocess.TimeoutExpired:
		return {
			'stdout': '',
			'stderr': '',
			'runtime_error': f'Code execution timed out after {CODE_RUN_TIMEOUT_SECONDS} seconds.',
			'results': [],
		}
	finally:
		try:
			os.remove(tmp_path)
		except OSError:
			pass

	stdout_lines = []
	runtime_error = ''
	parsed_results = []

	for line in str(completed.stdout or '').splitlines():
		if line.startswith('__TA_FATAL__'):
			try:
				fatal_payload = json.loads(line[len('__TA_FATAL__'):])
				runtime_error = str(fatal_payload.get('error') or '').strip()
			except json.JSONDecodeError:
				runtime_error = line[len('__TA_FATAL__'):].strip()
			continue
		if line.startswith('__TA_RESULT__'):
			try:
				result_payload = json.loads(line[len('__TA_RESULT__'):])
				if isinstance(result_payload.get('results'), list):
					parsed_results = result_payload['results']
			except json.JSONDecodeError:
				pass
			continue
		stdout_lines.append(line)

	if completed.returncode != 0 and not runtime_error:
		runtime_error = str(completed.stderr or '').strip() or 'Execution failed with a non-zero exit code.'

	passed_count = sum(1 for item in parsed_results if item.get('passed'))
	return {
		'stdout': '\n'.join(stdout_lines).strip(),
		'stderr': str(completed.stderr or '').strip(),
		'runtime_error': runtime_error,
		'results': parsed_results,
		'passed': passed_count,
		'total': len(parsed_results),
	}


@csrf_exempt
@require_POST
def chat(request):
	try:
		try:
			payload = json.loads(request.body or '{}')
		except json.JSONDecodeError:
			return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

		message = (payload.get('message') or '').strip()
		model_id = (payload.get('model') or '').strip()
		language = (payload.get('language') or '').strip()
		conversation_id = (payload.get('conversation_id') or '').strip()
		save_history = payload.get('save_history', True)
		images = payload.get('images') or []
		documents = payload.get('documents') or []
		audio = payload.get('audio') or None
		if not isinstance(images, list):
			images = []
		if not isinstance(documents, list):
			documents = []
		if len(language) > 40:
			return JsonResponse({'error': 'Language value is too long.'}, status=400)
		if not language:
			language = 'English'
		if not isinstance(save_history, bool):
			save_history = True

		transcript = ''

		if not message and not images and not audio and not documents:
			return JsonResponse({'error': 'Message, image, audio, or document is required.'}, status=400)
		if not model_id:
			return JsonResponse({'error': 'Model is required.'}, status=400)

		config = _get_model_config(model_id)
		if not config:
			return JsonResponse({'error': 'Unknown model.'}, status=400)
		if not config['api_key']:
			return JsonResponse({'error': 'Missing API key for selected provider.'}, status=500)
		if images and config['provider'] not in VISION_PROVIDERS:
			return JsonResponse({'error': 'Selected model does not support images.'}, status=400)

		if audio:
			groq_api_key = (PROVIDER_KEYS.get('groq') or '').strip()
			if not groq_api_key:
				return JsonResponse({'error': 'Missing GROQ_API_KEY (or groq_api_key) in backend .env.'}, status=500)
			try:
				transcript = _transcribe_audio_groq(audio, groq_api_key)
			except ValueError as exc:
				return JsonResponse({'error': str(exc)}, status=400)
			if transcript:
				# If audio is present, use Whisper transcript as the sole text input.
				message = transcript.strip()

		if not message and not images:
			if not documents:
				return JsonResponse({'error': 'No text extracted from audio.'}, status=400)

		documents_context, document_errors = _build_documents_context(documents)
		if documents and not documents_context and document_errors:
			return JsonResponse(
				{
					'error': 'Could not read uploaded document(s).',
					'details': ' | '.join(document_errors[:3]),
				},
				status=400,
			)

		if documents_context:
			document_prefix = 'Use the following extracted document content as your source of truth.\n\n'
			documents_block = f'{document_prefix}{documents_context}'
			if message:
				message = f'{message}\n\n{documents_block}'
			else:
				message = f'Explain this uploaded document in simple terms.\n\n{documents_block}'

		conversation_key = _ensure_in_memory_conversation(conversation_id)

		content = _build_content(message, images) if images else message
		messages = []
		system_prompt = (
			  "You are an expert teacher and teaching assistant.\n"

    "Your goal is to explain concepts clearly in a structured way.\n"

    "Explanation order (VERY IMPORTANT):\n"
    "1. First, explain the mathematical intuition.\n"
    "   - Include ALL key mathematical ideas (not just final formulas).\n"
    "   - Explain concepts like error, cost function, optimization, and how the model learns.\n"
    "2. Then, explain using real-world examples and scenarios.\n"

    "Guidelines:\n"
    "- Do not stop with a single formula.\n"
    "- Always explain the full process behind the concept.\n"
    "- Use simple language for math intuition (no heavy derivations).\n"

		    "For different types of questions:\n"
    "- Concept questions: Intuition (with full math ideas) → Example.\n"
    "- Math problems: Step-by-step solution.\n"
    "- Coding questions: Provide only code unless asked.\n"
		    "- Yes/No questions: Respond with only an affirmative or negative word in the selected response language.\n"

    "Context handling:\n"
    "- Use only provided documents if given.\n"
    "- Analyze images if provided.\n"

    "Honesty rule:\n"
    "- If unsure, say 'I don't know.'\n"

    "Style:\n"
    "- Use headings: 'Intuition' and 'Example'.\n"
    "- Keep it simple but complete.\n"
		)
		system_prompt = (
			f"{system_prompt}\n"
			f"Language rule (highest priority): Reply only in {language}. "
			"Do not switch to English unless the selected language is English."
		)
		messages.append({'role': 'system', 'content': system_prompt})

		history = _get_in_memory_history(conversation_key)[-MAX_HISTORY_MESSAGES:]
		for past in history:
			past_text = str(past.get('text') or '').strip()
			past_role = str(past.get('role') or '').strip()
			if past_text and past_role in {'user', 'assistant'}:
				messages.append({'role': past_role, 'content': past_text})

		messages.append(
			{
				'role': 'system',
				'content': f'Final reminder: answer only in {language}.',
			}
		)

		messages.append({'role': 'user', 'content': content})

		request_kwargs = {
			'model': config['model'],
			'messages': messages,
		}
		response_model = config['model']
		fallback_notice = ''

		if config['provider'] == 'google':
			google_keys = config.get('api_keys') or []
			if not google_keys:
				return JsonResponse({'error': 'Missing API key for selected provider.'}, status=500)
		else:
			request_kwargs['api_key'] = config['api_key']

		if config['provider'] == 'deepseek':
			request_kwargs['api_base'] = 'https://api.deepseek.com'

		try:
			if config['provider'] == 'google':
				response = _complete_with_google_fallback(request_kwargs, google_keys)
			else:
				response = completion(**request_kwargs)
			reply_content = response['choices'][0]['message']['content']
			if isinstance(reply_content, list):
				reply = ''.join(
					part.get('text', '') if isinstance(part, dict) else str(part)
					for part in reply_content
				).strip()
			else:
				reply = str(reply_content or '').strip()
		except RateLimitError as exc:
			if config['provider'] == 'google' and config['model'] != 'gemini/gemini-2.5-flash':
				fallback_request_kwargs = {
					**request_kwargs,
					'model': 'gemini/gemini-2.5-flash',
				}
				try:
					response = _complete_with_google_fallback(fallback_request_kwargs, google_keys)
					reply_content = response['choices'][0]['message']['content']
					if isinstance(reply_content, list):
						reply = ''.join(
							part.get('text', '') if isinstance(part, dict) else str(part)
							for part in reply_content
						).strip()
					else:
						reply = str(reply_content or '').strip()
					response_model = 'gemini/gemini-2.5-flash'
					fallback_notice = 'Selected Gemini model hit quota; used gemini-2.5-flash instead.'
				except RateLimitError:
					pass
				except Exception:
					pass
				if fallback_notice:
					# Fallback succeeded; skip returning 429.
					pass
				else:
					return JsonResponse(
						{
							'error': 'Rate limit exceeded for the selected model.',
							'details': str(exc),
						},
						status=429,
					)
			else:
				return JsonResponse(
					{
						'error': 'Rate limit exceeded for the selected model.',
						'details': str(exc),
					},
					status=429,
				)
		except Exception as exc:
			return JsonResponse({'error': str(exc)}, status=500)

		if save_history:
			stored_user_text = message or (f'[Sent {len(images)} image(s)]' if images else '')
			if documents:
				stored_user_text = f'{stored_user_text} [Sent {len(documents)} document(s)]'.strip()
			if stored_user_text:
				_append_in_memory_message(conversation_key, 'user', stored_user_text)
			_append_in_memory_message(conversation_key, 'assistant', reply)

		return JsonResponse(
			{
				'reply': reply,
				'conversation_id': conversation_key,
				'transcript': transcript,
				'model_used': response_model,
				'notice': fallback_notice,
			}
		)
	except Exception as exc:
		# Keep unexpected server failures JSON-formatted so the frontend can show a useful message.
		return JsonResponse({'error': 'Unexpected server error.', 'details': str(exc)}, status=500)


@csrf_exempt
@require_GET
def chat_history(request):
	conversation_id = (request.GET.get('conversation_id') or '').strip()
	if not conversation_id:
		return JsonResponse({'error': 'conversation_id is required.'}, status=400)
	return JsonResponse({'conversation_id': conversation_id, 'messages': _serialize_history(conversation_id)})


def _prune_community_messages(cutoff):
	CommunityMessage.objects.filter(created_at__lt=cutoff).delete()


def _contains_blocked_words(text):
	if not COMMUNITY_BLOCKED_WORDS:
		return False
	message = str(text or '').lower()
	return any(word in message for word in COMMUNITY_BLOCKED_WORDS if word)


@csrf_exempt
@require_GET
def community_messages(request):
	requester_name = str(request.GET.get('name') or '').strip()
	cutoff = timezone.now() - timedelta(seconds=60)
	_prune_community_messages(cutoff)
	items = CommunityMessage.objects.filter(created_at__gte=cutoff).order_by('created_at', 'id')
	return JsonResponse(
		{
			'messages': [
				{
					'id': item.id,
					'name': item.name,
					'message': item.message,
					'timestamp': int(item.created_at.timestamp()),
				}
				for item in items
				if not _contains_blocked_words(item.message) or (requester_name and item.name == requester_name)
			]
		}
	)


@csrf_exempt
@require_POST
def community_messages_post(request):
	try:
		payload = json.loads(request.body or '{}')
	except json.JSONDecodeError:
		return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

	name = str(payload.get('name') or '').strip()
	message = str(payload.get('message') or '').strip()

	if not name or not message:
		return JsonResponse({'error': 'name and message are required.'}, status=400)

	name = name[:80]
	message = message[:500]

	cutoff = timezone.now() - timedelta(seconds=60)
	_prune_community_messages(cutoff)

	item = CommunityMessage.objects.create(name=name, message=message)
	return JsonResponse(
		{
			'id': item.id,
			'name': item.name,
			'message': item.message,
			'timestamp': int(item.created_at.timestamp()),
		}
	)


@csrf_exempt
@require_POST
def community_messages_delete(request):
	try:
		payload = json.loads(request.body or '{}')
	except json.JSONDecodeError:
		return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

	message_id = payload.get('id')
	name = str(payload.get('name') or '').strip()

	if not message_id or not name:
		return JsonResponse({'error': 'id and name are required.'}, status=400)

	cutoff = timezone.now() - timedelta(seconds=60)
	_prune_community_messages(cutoff)

	try:
		item = CommunityMessage.objects.get(id=message_id)
	except CommunityMessage.DoesNotExist:
		return JsonResponse({'error': 'Message not found.'}, status=404)

	if item.name != name:
		return JsonResponse({'error': 'Not allowed to delete this message.'}, status=403)

	item.delete()
	return JsonResponse({'deleted': True, 'id': message_id})


@csrf_exempt
@require_GET
def google_auth_config(request):
	if not GOOGLE_OAUTH_CLIENT_ID:
		return JsonResponse({'error': 'Google OAuth client ID is not configured on the server.'}, status=500)
	redirect_uri = _resolve_google_redirect_uri(request)
	return JsonResponse(
		{
			'clientId': GOOGLE_OAUTH_CLIENT_ID,
			'redirectUri': redirect_uri,
		}
	)


@csrf_exempt
@require_POST
def google_auth(request):
	if not GOOGLE_OAUTH_CLIENT_ID or not GOOGLE_OAUTH_CLIENT_SECRET:
		return JsonResponse({'error': 'Google OAuth credentials are missing on the server.'}, status=500)

	try:
		payload = json.loads(request.body or '{}')
	except json.JSONDecodeError:
		return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

	code = str(payload.get('code') or '').strip()
	requested_redirect_uri = str(payload.get('redirect_uri') or '').strip().rstrip('/')
	if requested_redirect_uri:
		if not _is_allowed_google_redirect_uri(requested_redirect_uri):
			return JsonResponse({'error': 'Invalid redirect_uri provided.'}, status=400)
		redirect_uri = requested_redirect_uri
	else:
		redirect_uri = _resolve_google_redirect_uri(request)
	if not code:
		return JsonResponse({'error': 'Authorization code is required.'}, status=400)
	if not redirect_uri:
		redirect_uri = 'postmessage'

	try:
		token_payload = _post_form_json(
			'https://oauth2.googleapis.com/token',
			{
				'code': code,
				'client_id': GOOGLE_OAUTH_CLIENT_ID,
				'client_secret': GOOGLE_OAUTH_CLIENT_SECRET,
				'redirect_uri': redirect_uri,
				'grant_type': 'authorization_code',
			},
		)
	except urllib.error.HTTPError as exc:
		error_payload = _decode_json_response(exc.read())
		error_message = (
			str(error_payload.get('error_description') or '').strip()
			or str(error_payload.get('error') or '').strip()
			or 'Google token exchange failed.'
		)
		return JsonResponse({'error': error_message}, status=400)
	except urllib.error.URLError:
		return JsonResponse({'error': 'Unable to reach Google OAuth servers.'}, status=502)

	access_token = str(token_payload.get('access_token') or '').strip()
	id_token = str(token_payload.get('id_token') or '').strip()
	if not access_token and not id_token:
		return JsonResponse({'error': 'Google did not return an access token.'}, status=502)

	try:
		if access_token:
			user_payload = _get_json(
				'https://openidconnect.googleapis.com/v1/userinfo',
				headers={'Authorization': f'Bearer {access_token}'},
			)
		else:
			query = urllib.parse.urlencode({'id_token': id_token})
			user_payload = _get_json(f'https://oauth2.googleapis.com/tokeninfo?{query}')
	except urllib.error.HTTPError as exc:
		error_payload = _decode_json_response(exc.read())
		error_message = str(error_payload.get('error_description') or error_payload.get('error') or 'Failed to fetch Google profile.')
		return JsonResponse({'error': error_message}, status=400)
	except urllib.error.URLError:
		return JsonResponse({'error': 'Unable to fetch Google profile right now.'}, status=502)

	email = str(user_payload.get('email') or '').strip().lower()
	name = str(user_payload.get('name') or '').strip()
	picture = str(user_payload.get('picture') or '').strip()
	sub = str(user_payload.get('sub') or '').strip()

	if not email and not sub:
		return JsonResponse({'error': 'Google profile response is incomplete.'}, status=502)

	return JsonResponse(
		{
			'authenticated': True,
			'user': {
				'email': email,
				'name': name,
				'picture': picture,
				'sub': sub,
			},
		}
	)


@csrf_exempt
@require_POST
def google_auth_token(request):
	if not GOOGLE_OAUTH_CLIENT_ID:
		return JsonResponse({'error': 'Google OAuth client ID is not configured on the server.'}, status=500)

	try:
		payload = json.loads(request.body or '{}')
	except json.JSONDecodeError:
		return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

	access_token = str(payload.get('access_token') or '').strip()
	id_token = str(payload.get('id_token') or '').strip()
	if not access_token and not id_token:
		return JsonResponse({'error': 'Google access token or id token is required.'}, status=400)

	try:
		if id_token:
			query = urllib.parse.urlencode({'id_token': id_token})
			token_info = _get_json(f'https://oauth2.googleapis.com/tokeninfo?{query}')
		else:
			query = urllib.parse.urlencode({'access_token': access_token})
			token_info = _get_json(f'https://oauth2.googleapis.com/tokeninfo?{query}')
	except urllib.error.HTTPError as exc:
		error_payload = _decode_json_response(exc.read())
		error_message = str(error_payload.get('error_description') or error_payload.get('error') or 'Invalid Google token.')
		return JsonResponse({'error': error_message}, status=400)
	except urllib.error.URLError:
		return JsonResponse({'error': 'Unable to verify Google token.'}, status=502)

	aud = str(token_info.get('aud') or token_info.get('issued_to') or '').strip()
	if aud and aud != GOOGLE_OAUTH_CLIENT_ID:
		return JsonResponse({'error': 'Google token does not belong to this client.'}, status=400)

	if access_token:
		try:
			user_payload = _get_json(
				'https://openidconnect.googleapis.com/v1/userinfo',
				headers={'Authorization': f'Bearer {access_token}'},
			)
		except urllib.error.HTTPError as exc:
			error_payload = _decode_json_response(exc.read())
			error_message = str(error_payload.get('error_description') or error_payload.get('error') or 'Failed to fetch Google profile.')
			return JsonResponse({'error': error_message}, status=400)
		except urllib.error.URLError:
			return JsonResponse({'error': 'Unable to fetch Google profile right now.'}, status=502)

		email = str(user_payload.get('email') or '').strip().lower()
		name = str(user_payload.get('name') or '').strip()
		picture = str(user_payload.get('picture') or '').strip()
		sub = str(user_payload.get('sub') or '').strip()
	else:
		email = str(token_info.get('email') or '').strip().lower()
		name = str(token_info.get('name') or token_info.get('given_name') or '').strip()
		picture = str(token_info.get('picture') or '').strip()
		sub = str(token_info.get('sub') or '').strip()

	if not email and not sub:
		return JsonResponse({'error': 'Google profile response is incomplete.'}, status=502)

	return JsonResponse(
		{
			'authenticated': True,
			'user': {
				'email': email,
				'name': name,
				'picture': picture,
				'sub': sub,
			},
		}
	)


@csrf_exempt
@require_POST
def generate_mcq_test(request):
	try:
		try:
			payload = json.loads(request.body or '{}')
		except json.JSONDecodeError:
			return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

		topic = str(payload.get('topic') or '').strip()
		difficulty = str(payload.get('difficulty') or 'easy').strip().lower()
		count = payload.get('count', 15)
		model_id = str(payload.get('model') or TEST_GENERATION_MODEL).strip()

		if not topic:
			return JsonResponse({'error': 'Topic is required.'}, status=400)
		if difficulty not in {'easy', 'medium', 'hard'}:
			return JsonResponse({'error': 'difficulty must be easy, medium, or hard.'}, status=400)

		try:
			count = int(count)
		except (TypeError, ValueError):
			return JsonResponse({'error': 'count must be a valid integer.'}, status=400)

		if count < 1 or count > MAX_TEST_QUESTIONS:
			return JsonResponse({'error': f'count must be between 1 and {MAX_TEST_QUESTIONS}.'}, status=400)

		config = _get_model_config(model_id)
		if not config:
			return JsonResponse({'error': 'Unknown model for test generation.'}, status=400)
		if not config.get('api_key'):
			return JsonResponse({'error': 'Missing API key for selected provider.'}, status=500)

		system_prompt = (
			'You are an expert exam question setter. Generate highly topic-specific multiple-choice questions. '
			'Avoid generic questions and make each question clearly related to the requested topic.'
		)
		user_prompt = (
			f'Generate exactly {count} MCQ questions for topic: "{topic}" at {difficulty} difficulty. '\
			'Output only valid JSON (no markdown) with this exact schema: '\
			'{"questions":[{"question":"...","options":["A","B","C","D"],"correct_index":0}]}. '\
			'Rules: exactly 4 options per question, one correct option, no duplicate options, and no explanations.'
		)

		request_kwargs = {
			'model': config['model'],
			'messages': [
				{'role': 'system', 'content': system_prompt},
				{'role': 'user', 'content': user_prompt},
			],
		}

		if config['provider'] == 'google':
			google_keys = config.get('api_keys') or []
			if not google_keys:
				return JsonResponse({'error': 'Missing API key for selected provider.'}, status=500)
		else:
			request_kwargs['api_key'] = config['api_key']

		if config['provider'] == 'deepseek':
			request_kwargs['api_base'] = 'https://api.deepseek.com'

		try:
			if config['provider'] == 'google':
				response = _complete_with_google_fallback(request_kwargs, google_keys)
			else:
				response = completion(**request_kwargs)
		except RateLimitError as exc:
			return JsonResponse(
				{
					'error': 'Rate limit exceeded for selected model while generating test.',
					'details': str(exc),
				},
				status=429,
			)
		except Exception as exc:
			return JsonResponse({'error': str(exc)}, status=500)

		reply_content = response['choices'][0]['message']['content']
		if isinstance(reply_content, list):
			reply_text = ''.join(
				part.get('text', '') if isinstance(part, dict) else str(part)
				for part in reply_content
			).strip()
		else:
			reply_text = str(reply_content or '').strip()

		parsed = _extract_json_object(reply_text)
		normalized = _normalize_generated_questions(parsed, count)
		if not normalized:
			return JsonResponse(
				{
					'error': 'Model returned invalid question format. Please try again.',
				},
				status=502,
			)

		return JsonResponse(
			{
				'topic': topic,
				'difficulty': difficulty,
				'count': count,
				'questions': normalized,
			}
		)
	except Exception as exc:
		return JsonResponse({'error': 'Unexpected server error.', 'details': str(exc)}, status=500)


@csrf_exempt
@require_POST
def generate_coding_test(request):
	try:
		try:
			payload = json.loads(request.body or '{}')
		except json.JSONDecodeError:
			return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

		topic = str(payload.get('topic') or '').strip()
		difficulty = str(payload.get('difficulty') or 'medium').strip().lower()
		model_id = str(payload.get('model') or TEST_GENERATION_MODEL).strip()

		if not topic:
			return JsonResponse({'error': 'Topic is required.'}, status=400)
		if difficulty not in {'easy', 'medium', 'hard'}:
			return JsonResponse({'error': 'difficulty must be easy, medium, or hard.'}, status=400)

		config = _get_model_config(model_id)
		if not config:
			return JsonResponse({'error': 'Unknown model for coding test generation.'}, status=400)
		if not config.get('api_key'):
			return JsonResponse({'error': 'Missing API key for selected provider.'}, status=500)

		system_prompt = (
			'You create coding interview style problems with executable test cases. '
			'Always produce clean JSON only, no markdown.'
		)
		user_prompt = (
			f'Generate one Python coding problem for topic "{topic}" at {difficulty} difficulty. '
			'Output ONLY valid JSON with this exact schema: '
			'{"title":"...","description":"...","function_name":"...","function_signature":"def name(...):",'
			'"constraints":["..."],"examples":[{"input":"...","output":"..."}],'
			'"starter_code":"def name(...):\\n    pass",'
			'"visible_test_cases":[{"args":[...],"kwargs":{},"expected":...}],'
			'"hidden_test_cases":[{"args":[...],"kwargs":{},"expected":...}]} '
			'Rules: provide exactly 2 visible_test_cases and exactly 4 hidden_test_cases, '
			'args must be JSON array, kwargs must be JSON object, '
			'expected must be deterministic, no random values, no external libraries.'
		)

		request_kwargs = {
			'model': config['model'],
			'messages': [
				{'role': 'system', 'content': system_prompt},
				{'role': 'user', 'content': user_prompt},
			],
		}

		if config['provider'] == 'google':
			google_keys = config.get('api_keys') or []
			if not google_keys:
				return JsonResponse({'error': 'Missing API key for selected provider.'}, status=500)
		else:
			request_kwargs['api_key'] = config['api_key']

		if config['provider'] == 'deepseek':
			request_kwargs['api_base'] = 'https://api.deepseek.com'

		try:
			if config['provider'] == 'google':
				response = _complete_with_google_fallback(request_kwargs, google_keys)
			else:
				response = completion(**request_kwargs)
		except RateLimitError as exc:
			return JsonResponse(
				{
					'error': 'Rate limit exceeded for selected model while generating coding test.',
					'details': str(exc),
				},
				status=429,
			)
		except Exception as exc:
			return JsonResponse({'error': str(exc)}, status=500)

		reply_content = response['choices'][0]['message']['content']
		if isinstance(reply_content, list):
			reply_text = ''.join(
				part.get('text', '') if isinstance(part, dict) else str(part)
				for part in reply_content
			).strip()
		else:
			reply_text = str(reply_content or '').strip()

		parsed = _extract_json_object(reply_text)
		normalized = _normalize_coding_challenge(parsed, topic)
		if not normalized:
			normalized = _build_default_coding_challenge(topic)

		return JsonResponse(
			{
				'topic': topic,
				'difficulty': difficulty,
				'challenge': normalized,
			}
		)
	except Exception as exc:
		return JsonResponse({'error': 'Unexpected server error.', 'details': str(exc)}, status=500)


@csrf_exempt
@require_POST
def run_coding_test(request):
	try:
		try:
			payload = json.loads(request.body or '{}')
		except json.JSONDecodeError:
			return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

		code = str(payload.get('code') or '').strip()
		function_name = str(payload.get('function_name') or '').strip()
		test_cases = _normalize_runtime_test_cases(payload.get('test_cases'))

		if not code:
			return JsonResponse({'error': 'code is required.'}, status=400)
		if not function_name:
			return JsonResponse({'error': 'function_name is required.'}, status=400)
		if not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', function_name):
			return JsonResponse({'error': 'function_name is invalid.'}, status=400)
		if not test_cases:
			return JsonResponse({'error': 'test_cases must be a non-empty list.'}, status=400)

		run_result = _run_code_against_tests(code, function_name, test_cases)
		return JsonResponse(run_result)
	except Exception as exc:
		return JsonResponse({'error': 'Unexpected server error.', 'details': str(exc)}, status=500)
