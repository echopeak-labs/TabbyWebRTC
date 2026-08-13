# Problem

This project is currently a public project meant to be as easy as possible to
deploy/use/get running. Another developer (an end user of the repo) should be
able to clone it and run it on their own infra.

It does require Clerk and AWS setup. Both are needed when the end user clones
the repo. Today there is no step-by-step process that builds and deploys the
app on their own infra. The stack is wired to maintainer-specific domain,
Cloudflare, R2, ACM, and TURN values.

# Goal

Make this a bootstrapable project. The bootstrap will be a TUI app that can
help create the necessary env vars, domain, deployment, Clerk setup,
Cloudflare setup, plus the ability to switch to S3 as primary data storage.
