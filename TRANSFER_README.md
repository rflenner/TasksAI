# Task AI source transfer

This folder is a clean source snapshot for transfer to the `rflenner/TasksAI` GitHub repository.

It includes the application, email templates, access-control and registration flows, database schema, and migrations. It intentionally excludes API keys, `.env.local`, the local prototype database, dependencies, build output, and Git history.

## On the other Mac

1. Copy this folder to the other Mac.
2. Open Terminal inside the copied folder.
3. Run `git init`, add the GitHub repository as `origin`, commit, and push to `main`.
4. Create `.env.local` from `.env.example` and enter secrets locally. Never commit `.env.local`.

This snapshot is the current Cloudflare/D1 prototype. The next development step is converting it to standard Next.js, PostgreSQL, secure hosted sessions, and `render.yaml` before deploying it on Render.
