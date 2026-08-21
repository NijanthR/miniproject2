# 🚀 Deployment Guide: Render (Backend) & Vercel (Frontend)

This guide walks you step-by-step through deploying your **AI Teaching Assistant** full-stack application.

---

## 1. Deploy Backend on Render

### Step 1: Create a New Web Service
1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** ➔ **Web Service**.
3. Connect your GitHub repository (`NijanthR/miniproject2` or your repo).
4. Configure the basic settings:
   - **Name**: `teaching-assistant-backend` (or your preferred name)
   - **Root Directory**: `backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `./build.sh` (or `pip install -r requirements.txt && python manage.py collectstatic --no-input && python manage.py migrate`)
   - **Start Command**: `daphne -b 0.0.0.0 -p $PORT backend.asgi:application`

> [!NOTE]
> `daphne` is required because the project uses Django Channels for real-time WebSocket communication in the Community Study Lounge and HTTP for REST endpoints.

---

### Step 2: Set Environment Variables on Render
Under **Environment Variables** in your Render Web Service settings, add the following:

| Key | Example Value | Description |
| :--- | :--- | :--- |
| `SECRET_KEY` | *(generate a random string)* | Django security key |
| `DEBUG` | `False` | Production debug mode |
| `NVIDIA_API` | `nvapi-...` | Your NVIDIA NIM API key |
| `gemini_api_key` | `AQ...` | Your Google Gemini API key |
| `ALLOWED_HOSTS` | `.onrender.com,.vercel.app` | Allowed hosts |
| `CORS_ALLOWED_ORIGINS` | `https://your-frontend-name.vercel.app` | Your Vercel frontend domain |
| `CSRF_TRUSTED_ORIGINS` | `https://your-frontend-name.vercel.app` | Trusted CSRF origins |
| `GOOGLE_OAUTH_CLIENT_ID` | `1037028401491-...apps.googleusercontent.com` | Google OAuth Client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET`| `GOCSPX-...` | Google OAuth Client Secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://your-frontend-name.vercel.app/app` | Google OAuth Redirect URI |

*(Optional)* If you create a Render PostgreSQL database, Render will automatically inject `DATABASE_URL`, and the app will switch to PostgreSQL automatically.

---

### Step 3: Deploy & Copy Your Render URL
1. Click **Create Web Service** / **Deploy**.
2. Once deployed, Render will provide your public backend URL, e.g.:
   `https://teaching-assistant-backend.onrender.com`

---

## 2. Deploy Frontend on Vercel

### Step 1: Import Project into Vercel
1. Log in to [Vercel](https://vercel.com/).
2. Click **Add New...** ➔ **Project**.
3. Import your GitHub repository.
4. Configure the project settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `frontend` (Click *Edit* next to Root Directory and select `frontend`)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

---

### Step 2: Configure Environment Variables on Vercel
Under the **Environment Variables** section before clicking Deploy, add:

| Key | Value | Description |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | `https://teaching-assistant-backend.onrender.com` | Your Render backend URL (no trailing slash) |
| `VITE_WS_BASE_URL` | `wss://teaching-assistant-backend.onrender.com` | WebSocket URL for Render (note `wss://`) |

---

### Step 3: Deploy
1. Click **Deploy**.
2. Vercel will build and publish your frontend in ~30 seconds.
3. Your app will be live at `https://your-frontend-name.vercel.app`.

---

## 3. Post-Deployment Verification Checklist

1. **Google OAuth Authorized Origins & Redirects**:
   - Go to [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
   - Edit your OAuth 2.0 Client ID:
     - **Authorized JavaScript origins**: Add `https://your-frontend-name.vercel.app`.
     - **Authorized redirect URIs**: Add `https://your-frontend-name.vercel.app/app` and `https://your-frontend-name.vercel.app`.
2. **CORS on Render**:
   - In Render environment variables, verify `CORS_ALLOWED_ORIGINS` contains your exact Vercel URL.
3. **Verify Everything**:
   - ✅ Google Sign-In popup
   - ✅ Chat with NVIDIA Llama 3.1 & Gemini 3.5 models
   - ✅ Document uploads (`.docx`, `.pdf`)
   - ✅ Real-time Community Study Lounge
   - ✅ MCQ & Python Coding Sandbox
