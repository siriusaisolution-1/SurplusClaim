from surplus_scraper.spiders.healthcheck import HealthcheckSpider


def test_health_spider_name():
    spider = HealthcheckSpider()
    assert spider.name == "healthcheck"
