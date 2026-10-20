
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production

EXPOSE 9000 9101 9102 9103

CMD ["npm", "run", "dev:proxy"]
