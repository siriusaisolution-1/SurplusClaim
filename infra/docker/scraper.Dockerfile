FROM python:3.11-slim

ENV PIP_DISABLE_PIP_VERSION_CHECK=on \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY services/scraper/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/scraper/setup.py ./
COPY services/scraper/pyproject.toml ./
RUN pip install --no-cache-dir .

COPY services/scraper /app

RUN python setup.py bdist_egg \
  && mkdir -p /app/eggs \
  && cp dist/*.egg /app/eggs/

COPY services/scraper/scrapyd.conf /etc/scrapyd/scrapyd.conf

EXPOSE 6800

CMD ["scrapyd", "-c", "/etc/scrapyd/scrapyd.conf"]
