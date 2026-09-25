.PHONY: hooks lint check test test-all test-3.11 test-3.12 test-3.13 test-3.14

hooks:
	uv run pre-commit install

lint:
	uv run pre-commit run --all-files

check: lint test

test:
	uv run pytest

test-all: test-3.11 test-3.12 test-3.13 test-3.14

test-3.11:
	uv run --python 3.11 pytest

test-3.12:
	uv run --python 3.12 pytest

test-3.13:
	uv run --python 3.13 pytest

test-3.14:
	uv run --python 3.14 pytest
