# 🚀 Railway Deployment Guide

Complete guide for deploying the AI Workflow application to Railway.app.

## Prerequisites

- GitHub account with your code repository
- Railway account (sign up at https://railway.app - free tier available)
- All credentials ready (Supabase, CloudAMQP, API keys)

## Step 1: Create Railway Project

1. **Sign up/Login to Railway**
   - Go to https://railway.app
   - Click "Login with GitHub"
   - Authorize Railway to access your GitHub account

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your `ai-workflow` repository
   - Railway will detect your project structure

## Step 2: Set Up Backend Service

1. **Configure Backend Service**
   - Railway should auto-detect the backend
   - Click on the backend service
   - Go to "Settings" tab

2. **Set Root Directory** (Important!)
   - In Settings → "Service"
   - Set **Root Directory** to: `backend`
   - This tells Railway where your backend code is

3. **Configure Build & Start**
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start`
   - These should be auto-detected from `package.json`

## Step 3: Set Up Python Worker Service

1. **Add New Service**
   - In your Railway project dashboard
   - Click "+ New" → "Empty Service"
   - Name it: `python-worker`

2. **Configure Worker Service**
   - Go to Settings → "Service"
   - Set **Root Directory** to: `workers/python_worker`
   - Set **Build Command**: `pip install -r requirements.txt`
   - Set **Start Command**: `python worker.py`

3. **Connect to Repository**
   - In Settings → "Source"
   - Connect to the same GitHub repository
   - Select the main/master branch

## Step 4: Configure Environment Variables

You need to add environment variables to **BOTH** services (backend and python-worker).

### For Backend Service:

Click on backend service → "Variables" tab → Add all these (using **your own values**, not the placeholders):

```bash
DATABASE_URL=YOUR_DATABASE_URL_HERE
PORT=4000
NODE_ENV=production
RABBIT_URL=YOUR_RABBITMQ_URL_HERE
JWT_SECRET=YOUR_JWT_SECRET_HERE

# Supabase Storage
MINIO_ENDPOINT=YOUR_SUPABASE_STORAGE_ENDPOINT_HERE
MINIO_ACCESS_KEY=YOUR_SUPABASE_ACCESS_KEY_HERE
MINIO_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY_HERE
MINIO_BUCKET=artifacts
MINIO_USE_SSL=true
MINIO_PORT=443

# AI APIs
GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
GEMINI_MODEL=gemini-2.0-flash-exp
PPLX_API_KEY=YOUR_PPLX_API_KEY_HERE
PPLX_MODEL=sonar-pro
SAMBANOVA_API_KEY=YOUR_SAMBANOVA_API_KEY_HERE
SAMBANOVA_BASE_URL=https://api.sambanova.ai/v1
SAMBANOVA_MODEL=deepseek-r1-distill-llama-70b
```

### For Python Worker Service:

Click on python-worker service → "Variables" tab → Add the **SAME** variables as above.

> **💡 Tip**: Railway allows you to copy variables between services. After adding them to backend, you can use the "Copy from another service" option.

## Step 5: Deploy

1. **Trigger Deployment**
   - Both services should automatically start building after you add environment variables
   - Watch the build logs in real-time

2. **Monitor Build Progress**
   - Backend build: Should complete in 2-3 minutes
   - Python worker build: Should complete in 1-2 minutes

3. **Check for Success**
   - Look for "Build successful" and "Deployment live" messages
   - Check that both services show "Active" status

## Step 6: Verify Deployment

### Test Backend Health

1. **Get Backend URL**
   - Click on backend service
   - Go to "Settings" → "Networking"
   - Click "Generate Domain" if not already generated
   - Copy the public URL (e.g., `https://ai-workflow-backend.up.railway.app`)

2. **Test Health Endpoint**
   - Open browser or use curl:
   ```bash
   curl https://your-backend-url.up.railway.app/health
   ```
   - Should return: `{"status": "healthy"}` or similar

### Check Database Connection

1. **View Backend Logs**
   - Click on backend service → "Deployments" → Latest deployment
   - Look for log messages like:
     - ✅ `Database connected successfully`
     - ✅ `Connected to PostgreSQL`
   - 🚫 Should NOT see timeout errors

### Check Worker Connection

1. **View Worker Logs**
   - Click on python-worker service → "Deployments" → Latest deployment
   - Look for:
     - ✅ `Connected to RabbitMQ`
     - ✅ `Worker started and listening`
   - 🚫 Should NOT see connection errors

## Step 7: Test End-to-End

### Create a Test Workflow

```bash
curl -X POST https://your-backend-url.up.railway.app/api/workflows \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Test Workflow",
    "description": "Testing Railway deployment"
  }'
```

### Verify Processing

1. Check worker logs - should show job pickup
2. Check backend logs - should show workflow status updates
3. Verify artifacts in Supabase Storage bucket

## Troubleshooting

### Build Failures

**Problem**: Backend build fails with TypeScript errors
- **Solution**: Make sure all dependencies are in `dependencies` (not `devDependencies`)

**Problem**: Python worker can't find modules
- **Solution**: Verify `requirements.txt` is in `workers/python_worker/` directory

### Connection Issues

**Problem**: Database timeout errors
- **Solution**: This was the Render problem! Railway has better routing. If you still see this, try the direct Supabase URL instead of pooler.

**Problem**: RabbitMQ connection refused
- **Solution**: Double-check `RABBIT_URL` format - should be `amqps://` (with 's' for SSL)

### Runtime Errors

**Problem**: "Port already in use" or port binding errors
- **Solution**: Railway auto-assigns `PORT` variable. Make sure your code reads from `process.env.PORT`

## Railway vs Render Comparison

| Feature | Railway | Render |
|---------|---------|--------|
| Free tier | ✅ $5/month free credit | ✅ Free tier available |
| Database routing | ✅ Better compatibility | ❌ Issues with Supabase |
| Build speed | ✅ Fast (1-3 min) | ✅ Similar |
| Logs | ✅ Real-time | ✅ Real-time |
| Environment vars | ✅ Easy to copy between services | ⚠️ Manual per service |
| Auto-deploy | ✅ On git push | ✅ On git push |

## Next Steps

After successful deployment:

1. **Update Frontend** - Point your frontend to the new Railway backend URL
2. **Set Up Custom Domain** (Optional) - Railway supports custom domains
3. **Monitor Usage** - Check Railway dashboard for resource usage
4. **Set Up Notifications** - Configure deployment notifications in Railway

---

## Need Help?

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Our troubleshooting worked locally, so any issues are likely configuration-related!

**🎉 Your application is now deployed on Railway!**
