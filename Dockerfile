FROM node:18

WORKDIR /app

RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY requirements.txt ./

RUN npm install --production
RUN pip3 install -r requirements.txt --break-system-packages

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]