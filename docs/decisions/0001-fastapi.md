# Use FastAPI as Python web API framework

## Context and Problem Statement

We need to serve content from a backend linked to a database, to the frontend
for display.

Historically Django (DRF) and Flask were best. Since `asgi` had more adoption,
async frameworks are key.

FastAPI was the first to market to combine many powerful features:

- ASGI Starlette + Uvicorn server.
- Pydantic validation.
- OpenAPI spec parsing.

[Alternatives page](https://fastapi.tiangolo.com/alternatives) in FastAPI docs.

## Considered Options

- Django Rest Framework
- Flask
- FastAPI

## Decision Outcome

We chose FastAPI for Field-TM in 2022 is it was a well adopted, with a
large community, and has great developer experience. It's also quite performant.

This decision follows on from that, building on our previous experience for our
need tool, Drone-TM.

### Consequences

- Good, because code is much more concise and understandable.
- Good, because endpoints are auto-documented as OpenAPI.
- Bad, because as with any decision at this level, migration away becomes difficult
  (would require a rewrite using another framework).
