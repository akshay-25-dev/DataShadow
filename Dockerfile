# One container serves the API and the built client on a single port.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY server ./server
COPY client ./client
COPY scripts ./scripts
COPY docs ./docs
RUN npm ci && npm run build
ENV NODE_ENV=production
EXPOSE 8788
CMD ["npm", "start"]
