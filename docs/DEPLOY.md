# Deploy in 10 minutes (free)

1. **GitHub**: create an empty repo named `dhara-ai` under `shiv-codez`, then in this folder:
   ```bash
   git init && git add . && git commit -m "Dhara.ai prototype (SIH26012)"
   git branch -M main
   git remote add origin https://github.com/shiv-codez/dhara-ai.git
   git push -u origin main
   ```
2. **Vercel**: sign in with GitHub, *Add New > Project*, pick the repo, set **Root Directory = `frontend`**
   (framework Vite is auto-detected), *Deploy*. Put the resulting `*.vercel.app` URL on the slide.
3. Later changes: just `git push`. The production URL stays the same; each push redeploys it in about a minute.
   Do not rename the Vercel project or the GitHub repo after putting the links on the slide.
4. Optional API on **Render**: *New > Blueprint*, select the repo (uses `render.yaml`). Not needed for the demo.
