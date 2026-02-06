FROM node:18-alpine

# pracovní adresář v kontejneru
WORKDIR /app

# nejdřív jen závislosti (kvůli cache)
COPY package*.json ./
RUN npm install --production

# zbytek aplikace
COPY . .

# port, na kterém appka běží
EXPOSE 3000

# start aplikace
CMD ["node", "index.js"]
