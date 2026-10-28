FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./
# O script executado é definido por serviço no docker-compose.yml
CMD ["python", "field_node.py"]
