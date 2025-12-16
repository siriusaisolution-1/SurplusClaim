import scrapy


class HealthcheckSpider(scrapy.Spider):
  name = "healthcheck"
  start_urls = ["https://example.org/"]

  def parse(self, response):
    yield {"status": "ok", "url": response.url}
