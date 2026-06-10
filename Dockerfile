FROM public.ecr.aws/lambda/nodejs:24.2026.05.15.23-x86_64

WORKDIR /var/task

COPY package*.json ./

RUN npm ci --only=production

COPY src/index.js ./

CMD [ "index.handler" ]