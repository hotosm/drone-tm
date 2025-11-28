# Setting Up DroneTM For Development

## Prerequisites

!!! important

    You must have Docker and Docker Compose installed first:

    - [Docker install guide](https://docs.docker.com/engine/install)
    - [Docker Compose install guide](https://docs.docker.com/compose/install)

Just is required too:

- [Just](https://github.com/casey/just#installation)

## (Optional) Configure Google OAuth

- Create a new client ID and secret in your Google account for OAuth2.
- Set the redirect URL to your local frontend URL, e.g. `http://localhost:3040/auth`.

!!! note

      This step is only required to use the frontend.

## Configure Your Dotenv

- There is an example `.env.example` file that `.env` can be generated from using this command:
  `just config generate-dotenv`
- If you only plan on using the backend then everything should be
  configured for you.
- Else, if you set up Google OAuth credentials, set the variables here:
  ```dotenv
  GOOGLE_CLIENT_ID="YOUR_CLIENT_ID"
  GOOGLE_CLIENT_SECRET="YOUR_CLIENT_SECRET"
  GOOGLE_LOGIN_REDIRECT_URI="http://localhost:3040/auth"
  ```

#### Monitoring

- At present, only Sentry is configured as the default backend for logging with OpenTelemetry.
- To set it up and work with it, you will need a valid Sentry DSN.
- `LOG_LEVEL` is set to `info` by default. Setting it to `debug` makes the logs very verbose, so it
is recommended to leave the setting as is.

### Build and Run The Containers

- The `Justfile` in the project root contains all the logic needed to build and run the application.
- `compose.sub.yaml` is used for production builds - `compose.yaml`, meanwhile, is used for development.
- To start the application, run:
  `just start all`
- This command will pull the required Docker images and start all services correctly.

### Access The Services

DroneTM Backend: [http://localhost:8000](http://localhost:8000)

DroneTM Frontend: [http://localhost:3040](http://localhost:3040)

Web ODM: [http://localhost:9900](http://localhost:9900)

- Default user: `admin`
- Default password: `password`

> Note the ports may be different if you changed them in the dotenv file.

[1]: https://docs.docker.com/engine/install/#other-linux-distros "Docker Install Guide"
[2]: https://docs.docker.com/compose/install/#scenario-two-install-the-compose-plugin "Docker Compose Install Guide"
