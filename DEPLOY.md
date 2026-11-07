# Deploying

The site is a static build served by nginx in Docker, hosted with Dokploy on the OVH VPS (`ssh ovh`). Releases are
manual:

1. Run the **Build & Push** GitHub Action by hand.
2. It tags a new version (`v0.0.1`, `v0.0.2`, …) and pushes the image to `ghcr.io/adamedmunds/gtnh-planner`.
3. Bump the image tag in Dokploy.

Merging to `main` does **not** build or deploy anything.

**Game content is not in the image or the repo.** The recipe data, icons and textures come from your own GTNH install.
They live in `/home/ubuntu/gtnh-planner/` on the VPS, which is mounted into the container. So:

- They never go to GitHub.
- You can update them without a rebuild.
- You can take them down by deleting one folder.

## First deploy

### 1. Build the game content locally

```bash
npm run recipes    # writes public/data/ (recipes.json.gz, recipes-meta.json, icons/)
npm run textures   # writes public/textures/
```

### 2. Upload it to the VPS

```bash
ssh ovh "mkdir -p ~/gtnh-planner"
scp -r public/data public/textures ovh:gtnh-planner/
```

You should end up with `/home/ubuntu/gtnh-planner/data/recipes.json.gz` and `/home/ubuntu/gtnh-planner/textures/blocks/...`.

### 3. Build the first image

On GitHub, go to **Actions → Build & Push → Run workflow**, keep the branch on `main`, and pick the version bump
(`patch` is the default). It must run on `main`; on any other branch it does nothing.

The GHCR package is private by default. Either:

- add a `ghcr.io` registry in Dokploy (**Settings → Registry**) with your GitHub username and a personal access token
  that has `read:packages`, or
- make the package public under GitHub → Packages → gtnh-planner → Package settings.

### 4. Create the app in Dokploy

1. Create a **Project**, then add an **Application**.
2. Under **Provider**, choose **Docker** and enter the image `ghcr.io/adamedmunds/gtnh-planner:<version>` (for example
   `0.0.1`). Pick the GHCR registry if the package is private.
3. Under **Advanced → Volumes**, add two **Bind Mounts**:

   | Host path                            | Mount path                        |
   |--------------------------------------|-----------------------------------|
   | `/home/ubuntu/gtnh-planner/data`     | `/usr/share/nginx/html/data`      |
   | `/home/ubuntu/gtnh-planner/textures` | `/usr/share/nginx/html/textures`  |

4. Under **Domains**, add your domain with **container port 80**, and turn HTTPS on.
   - Point the domain's DNS at the OVH IP (`51.89.151.47`).
   - Use the same certificate setup as your other domains. Behind Cloudflare that's usually Let's Encrypt with
     Cloudflare SSL set to **Full (strict)**.
   - The OVH Edge Network Firewall already allows ports 80 and 443, so nothing else needs opening.
5. Press **Deploy**.

### 5. Check it

```bash
curl -I https://<domain>/                                # 200
curl -I https://<domain>/data/recipes.json.gz            # 200, not text/html
curl -I https://<domain>/data/recipes-meta.json          # 200
```

Then open the site. The Calculator should load recipes, and the 3D editor should show textured machines.

## Releasing an update

1. Merge your changes to `main`.
2. Run **Actions → Build & Push → Run workflow** on `main`.
3. In Dokploy, change the image tag to the new version and press **Deploy**.

## Updating the game content (new GTNH version)

1. Re-run `npm run recipes` / `npm run textures`.
2. `scp -r` the folders again.

There's no redeploy. Browsers pick up the new files within an hour.

## Taking content down

If someone asks for their content to be removed, delete the files from `/home/ubuntu/gtnh-planner/` on the VPS. The
app still loads without them: blocks show plain colours, and the Calculator says "No recipe data yet".
