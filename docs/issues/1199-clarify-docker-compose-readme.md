# 📌 Issue Preview: documentation: clarify the Docker Compose local-dev flow in the README

**Labels:** `documentation`, `dx`, `low-risk`

---

### Description
New contributors following [README.md](README.md#L529-L548) ("Running Full Backend Stack") run into ambiguity around the Docker Compose local-dev flow. The section lists `cd backend && docker-compose up` and the services it exposes, but leaves out details a first-time reader needs:

- [backend/docker-compose.yml](backend/docker-compose.yml) also starts an `indexer` service that isn't mentioned in the README's service list (only API, pgAdmin, PostgreSQL, Redis are called out).
- The first `docker-compose up` builds Rust images (`Dockerfile.api`, `Dockerfile.indexer`) from source, which can take several minutes — the README doesn't set that expectation, so it looks "stuck" to a new contributor.
- There's no example of what a successful startup looks like (expected log lines / how to confirm the API is actually up), and no mention of default credentials already baked into the compose file (`stellar` / `stellar_dev_password`, pgAdmin `admin@stellar.dev` / `admin`).

### Files Involved
- [README.md](README.md#L529-L548)
- [backend/docker-compose.yml](backend/docker-compose.yml) (source of truth for services/ports/credentials)

### Action Items
- [ ] Add the `indexer` service to the README's service list alongside API/pgAdmin/PostgreSQL/Redis
- [ ] Note that the first run builds Rust binaries and may take a few minutes
- [ ] Add a concrete "how to confirm it worked" step, e.g. `curl http://localhost:3001/api/bounties` or a healthy-container check (`docker-compose ps`)
- [ ] Document the default dev credentials already present in `docker-compose.yml` so contributors aren't left guessing
- [ ] Re-read the full section end-to-end to confirm no other doc references the old/incomplete version of this flow
