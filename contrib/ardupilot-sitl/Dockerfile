# syntax=docker/dockerfile:1
# ArduCopter SITL from the official prebuilt binary.
# The binary is statically linked, so it runs on an empty base image.
FROM scratch
ARG COPTER_VERSION=4.7.3
LABEL org.opencontainers.image.source=https://github.com/hotosm/drone-tm
WORKDIR /sitl
ADD --chmod=755 \
    https://firmware.ardupilot.org/Copter/stable-${COPTER_VERSION}/SITL_x86_64_linux_gnu/arducopter .
ADD https://raw.githubusercontent.com/ArduPilot/ardupilot/Copter-${COPTER_VERSION}/Tools/autotest/default_params/copter.parm .
# MAVLink over TCP, connect QGroundControl here
EXPOSE 5760
ENTRYPOINT ["./arducopter", "--model", "quad", "--defaults", "copter.parm"]
# --home lat,lon,alt_msl,heading
CMD ["--home", "39.9656,-75.1810,276,180"]
