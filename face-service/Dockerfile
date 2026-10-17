FROM python:3.10

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

RUN pip install --upgrade pip
RUN pip install --no-cache-dir --prefer-binary -r requirements.txt

COPY . .

EXPOSE 5300

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5300"]
