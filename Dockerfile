FROM node:20-bullseye-slim

WORKDIR /app

ENV NODE_ENV=production

COPY . .

RUN cd client && npm install && npm run build
RUN cd server && npm install

ENV PORT=8080
EXPOSE 8080

WORKDIR /app/server
CMD ["npm", "start"]
