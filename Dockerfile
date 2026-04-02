FROM node:22-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "run", "dev"]
