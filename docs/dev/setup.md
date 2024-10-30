# Setting Up Drone TM For Development

!!! important

      You must have Docker and Docker Compose installed first.

      Docker install guide: [https://docs.docker.com/engine/install][1]

      Compose install guide: [https://docs.docker.com/compose/install][2]

## (Optional) Configure Google OAuth

- Create a new client ID and secret in your Google account for OAuth2.
- Set the redirect URL to your local frontend URL, e.g. `http://localhost:3040/auth`.

!!! note

      This step is only required to use the frontend.

## Configure Your Dotenv

- There is an example `.env.example` file that can be copied:
  `cp .env.example .env`
- If you only plan on using the backend then everything should be
  configured for you.
- Else, if you set up Google OAuth credentials, set the variables here:
  ```dotenv
  GOOGLE_CLIENT_ID="YOUR_CLIENT_ID"
  GOOGLE_CLIENT_SECRET="YOUR_CLIENT_SECRET"
  GOOGLE_LOGIN_REDIRECT_URI="http://localhost:3040/auth"
  ```

## Build The Containers

```bash
docker compose build
```

### Run The Containers

This will also run ODM alongside DroneTM:

```bash
docker compose -f docker-compose.yml -f docker-compose.odm.yml up -d
```

### Access The Services

DroneTM Backend: [http://localhost:8000](http://localhost:8000)

DroneTM Frontend: [http://localhost:3040](http://localhost:3040)

Web ODM: [http://localhost:9900](http://localhost:9900)

- Default user: `admin`
- Default password: `password`

> Note the ports may be different if you changed them in the dotenv file.

[1]: https://docs.docker.com/engine/install/#other-linux-distros "Docker Install Guide"
[2]: https://docs.docker.com/compose/install/#scenario-two-install-the-compose-plugin "Docker Compose Install Guide"
