# Copyright (c) Humanitarian OpenStreetMap Team
#
# This file is part of Drone-TM.
#
#     Drone-TM is free software: you can redistribute it and/or modify
#     it under the terms of the GNU General Public License as published by
#     the Free Software Foundation, either version 3 of the License, or
#     (at your option) any later version.
#
#     Drone-TM is distributed in the hope that it will be useful,
#     but WITHOUT ANY WARRANTY; without even the implied warranty of
#     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#     GNU General Public License for more details.
#
#     You should have received a copy of the GNU General Public License
#     along with Drone-TM.  If not, see <https:#www.gnu.org/licenses/>.
#

set dotenv-load

mod build 'tasks/build'
mod start 'tasks/start'
mod config 'tasks/config'
mod test 'tasks/test'
mod process 'tasks/process'

# List available commands
[private]
default:
  just help

# List available commands
help:
  just --justfile {{justfile()}} --list

# Prep module from https://github.com/hotosm/justfiles
prep *args:
    @curl -sS https://raw.githubusercontent.com/hotosm/justfiles/main/prep.just \
      -o {{justfile_directory()}}/tasks/prep.just;
    @just --justfile {{justfile_directory()}}/tasks/prep.just {{args}}

# Chart module from https://github.com/hotosm/justfiles
chart *args:
    @curl -sS https://raw.githubusercontent.com/hotosm/justfiles/main/chart.just \
      -o {{justfile_directory()}}/tasks/chart.just;
    @just --justfile {{justfile_directory()}}/tasks/chart.just --set chart_name "drone-tm" {{args}}

# Run database migrations
migrate:
  docker compose run --rm migrations alembic upgrade head

# Autogenerate a migration by diffing the SQLAlchemy models against the DB.
db-revision message:
  just migrate
  docker compose run --rm migrations alembic revision --autogenerate -m "{{message}}"

# Run pre-commit hooks
lint:
  #!/usr/bin/env sh
  cd {{justfile_directory()}}/src/backend
  uv run pre-commit run --all-files

# Increment Drone-TM
bump:
  #!/usr/bin/env sh
  cd {{justfile_directory()}}/src/backend
  uv run cz bump --check-consistency

# Increment drone-flightplan (doesn't work yet!)
bump-drone-flightplan:
  #!/usr/bin/env sh
  cd {{justfile_directory()}}/src/backend
  uv --project packages/drone-flightplan --directory packages/drone-flightplan run cz bump --check-consistency

# Run docs website locally
docs:
  #!/usr/bin/env sh
  cd {{justfile_directory()}}/src/backend
  uv sync --group docs
  uv run mkdocs serve --config-file ../../mkdocs.yml --dev-addr 0.0.0.0:3000

# Install curl if missing
[private]
_install-curl:
  #!/usr/bin/env bash
  set -e

  if ! command -v curl &> /dev/null; then
      echo "📦 Installing curl..."
      if command -v apt-get &> /dev/null; then
          sudo apt-get update -qq && sudo apt-get install -y curl
      elif command -v yum &> /dev/null; then
          sudo yum install -y curl
      elif command -v apk &> /dev/null; then
          sudo apk add --no-cache curl
      else
          echo "❌ Error: curl is not installed and no package manager found"
          echo "   Please install curl manually"
          exit 1
      fi
      echo "✓ curl installed"
  fi

# Arrow-key selection menu. Draws on stderr, prints chosen item to stdout.
# Usage: chosen=$(just _select-menu "Pick one:" item1 item2 item3)
[no-cd]
_select-menu prompt +items:
  #!/usr/bin/env bash
  set -e

  IFS=' ' read -ra opts <<< "{{ items }}"
  count=${#opts[@]}
  selected=0

  # Print prompt
  printf "\033[0;34m%s\033[0m\n" "{{ prompt }}" >&2

  # Hide cursor, restore on exit
  tput civis >&2 2>/dev/null
  trap 'tput cnorm >&2 2>/dev/null' EXIT

  draw_menu() {
    for i in "${!opts[@]}"; do
      tput el >&2 2>/dev/null
      if [ "$i" -eq "$selected" ]; then
        printf "  \033[7m > %s \033[0m\n" "${opts[$i]}" >&2
      else
        printf "    %s\n" "${opts[$i]}" >&2
      fi
    done
  }

  draw_menu
  while true; do
    read -rsn1 key
    case "$key" in
      $'\x1b')
        read -rsn2 rest
        case "$rest" in
          '[A') ((selected > 0)) && ((selected--)) || true ;;
          '[B') ((selected < count - 1)) && ((selected++)) || true ;;
        esac
        ;;
      '')  # enter
        break
        ;;
    esac
    printf "\033[%dA" "$count" >&2
    draw_menu
  done

  printf "\n" >&2
  echo "${opts[$selected]}"

# Echo to terminal with blue colour
[no-cd]
_echo-blue text:
  #!/usr/bin/env sh
  printf "\033[0;34m%s\033[0m\n" "{{ text }}"

# Echo to terminal with yellow colour
[no-cd]
_echo-yellow text:
  #!/usr/bin/env sh
  printf "\033[0;33m%s\033[0m\n" "{{ text }}"

# Echo to terminal with red colour
[no-cd]
_echo-red text:
  #!/usr/bin/env sh
  printf "\033[0;41m%s\033[0m\n" "{{ text }}"
