# Node 14 (matches the verified local toolchain: Node 14.21.3 + Yarn classic).
# pm2 is pinned: unpinned `yarn global add pm2` pulls pidusage@4 which requires
# Node >=18 and breaks this Node 14 build. Frontend app deps are unchanged.
FROM node:14.21.3-alpine

WORKDIR /usr/src/app

RUN yarn global add pm2@5.4.3

# Installing dependencies
COPY package*.json ./
COPY yarn.lock ./
RUN yarn install

# Copying source files
COPY . .

# Build the production build 
RUN yarn build
