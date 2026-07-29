# Security policy

This repository is a public preview and does not yet publish supported release lines.

Do not open a public issue for a suspected vulnerability. Use GitHub's private security
advisory reporting for this repository, including reproduction steps and affected
commit. The maintainers will acknowledge a report when available, investigate it, and
coordinate disclosure. No response-time or bug-bounty commitment is offered.

Treat external manifests and assets as untrusted input. Deploy the showcase over HTTPS,
restrict content origins where practical, review CORS, and do not embed credentials or
private dataset URLs in builds. This project does not need secrets to play public data.
