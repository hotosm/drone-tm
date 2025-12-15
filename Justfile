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

mod build 'tasks/build/Justfile'
mod start 'tasks/start/Justfile'
mod config 'tasks/config/Justfile'
mod prep 'tasks/prep/Justfile'
mod test 'tasks/test/Justfile'

# List available commands
[private]
default:
  just help

# List available commands
help:
  just --justfile {{justfile()}} --list

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
