# Python 3.11 slim matches the verified local backend baseline (was python:3.6,
# EOL). Debian-slim provides manylinux wheels for lxml/cryptography/etc., so no
# apt build toolchain is required. Installing the exact lockfile keeps the Docker
# dependency set identical to the verified local baseline.
FROM python:3.11-slim

# Dump logs without buffering
ENV PYTHONUNBUFFERED=1

WORKDIR /home/flask/app/web

# Install the exact, verified dependency set.
COPY requirements.lock.txt /home/flask/app/web/
RUN pip install --no-cache-dir -r requirements.lock.txt

# Copy the source code into the container
COPY . /home/flask/app/web
COPY project/static  /usr/src/app/web/project/static
