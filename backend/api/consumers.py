import json
from datetime import timedelta

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.utils import timezone

from .models import CommunityMessage

MESSAGE_TTL_SECONDS = 60


class CommunityChatConsumer(AsyncWebsocketConsumer):
    group_name = 'community_chat'

    async def connect(self):
        await self.accept()
        if self.channel_layer:
            await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self._send_snapshot()

    async def disconnect(self, close_code):
        if self.channel_layer:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    @database_sync_to_async
    def _create_message(self, name, message):
        cutoff = timezone.now() - timedelta(seconds=MESSAGE_TTL_SECONDS)
        CommunityMessage.objects.filter(created_at__lt=cutoff).delete()
        item = CommunityMessage.objects.create(name=name, message=message)
        return {
            'id': item.id,
            'name': item.name,
            'message': item.message,
            'timestamp': int(item.created_at.timestamp()),
        }

    @database_sync_to_async
    def _get_active_messages(self):
        cutoff = timezone.now() - timedelta(seconds=MESSAGE_TTL_SECONDS)
        CommunityMessage.objects.filter(created_at__lt=cutoff).delete()
        items = CommunityMessage.objects.filter(created_at__gte=cutoff).order_by('created_at', 'id')
        return [
            {
                'id': item.id,
                'name': item.name,
                'message': item.message,
                'timestamp': int(item.created_at.timestamp()),
            }
            for item in items
        ]

    @database_sync_to_async
    def _delete_message(self, message_id, name):
        try:
            item = CommunityMessage.objects.get(id=message_id, name=name)
            item.delete()
            return True
        except CommunityMessage.DoesNotExist:
            return False

    async def receive(self, text_data=None, bytes_data=None):
        payload = self._parse_json(text_data)
        action = payload.get('action') or 'send'

        if action == 'delete':
            msg_id = payload.get('id')
            name = str(payload.get('name') or '').strip()
            if msg_id and name:
                deleted = await self._delete_message(msg_id, name)
                if deleted and self.channel_layer:
                    await self.channel_layer.group_send(
                        self.group_name,
                        {
                            'type': 'broadcast_delete',
                            'id': msg_id,
                        },
                    )
            return

        name = str(payload.get('name') or '').strip()[:80]
        message = str(payload.get('message') or '').strip()[:500]

        if not name or not message:
            return

        new_message = await self._create_message(name, message)

        if self.channel_layer:
            await self.channel_layer.group_send(
                self.group_name,
                {
                    'type': 'broadcast_message',
                    'message': new_message,
                },
            )
        else:
            await self.send(
                text_data=json.dumps(
                    {
                        'type': 'message',
                        'message': new_message,
                    }
                )
            )

    async def broadcast_message(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    'type': 'message',
                    'message': event.get('message'),
                }
            )
        )

    async def broadcast_delete(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    'type': 'delete',
                    'id': event.get('id'),
                }
            )
        )

    async def _send_snapshot(self):
        messages = await self._get_active_messages()
        await self.send(
            text_data=json.dumps(
                {
                    'type': 'snapshot',
                    'messages': messages,
                }
            )
        )

    @staticmethod
    def _parse_json(text_data):
        if not text_data:
            return {}
        try:
            return json.loads(text_data)
        except json.JSONDecodeError:
            return {}
