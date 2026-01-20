# Testing DroneTM

## Test Data

| Repo                                                      | Description                                                  | Purpose                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| <https://github.com/spwoodcock/drone-testdata-agung-1>    | Mt Agung, Bali. Random sample from a few task areas.         | Testing uploader, EXIF issues, image issues.                                    |
| <https://github.com/spwoodcock/drone-testdata-dokan-tofa> | Dokan Tofa, Nigeria. Regular grid imagery collection.        | Testing uploader, EXIF issues, image issues.                                    |
| <https://github.com/spwoodcock/drone-testdata-agung-1>    | Mt Agung, Bali. Four adjacent tasks, including flight tails. | Testing full upload and processing workflow, including removal of flight tails. |

## Backend Tests

- We use PyTest for backend tests.
- Either run using `just` or inspect the Justfile to see how to run manually:

```bash
just test backend
```
