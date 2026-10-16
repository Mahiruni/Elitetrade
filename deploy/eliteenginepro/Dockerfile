FROM node:24-bookworm AS windows-python
RUN apt-get update && apt-get install --no-install-recommends -y python3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY deploy/eliteenginepro/artifacts.json deploy/eliteenginepro/bootstrap-runtime.py /bootstrap/
RUN python3 /bootstrap/bootstrap-runtime.py /bootstrap/artifacts.json /opt/winpython

FROM node:24-bookworm
RUN apt-get update && apt-get install --no-install-recommends -y wine wine64 xvfb xauth fonts-liberation tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/elitetrade
COPY --from=windows-python /opt/winpython /opt/winpython
COPY --chown=node:node src/eliteenginepro-runtime.mjs ./src/
COPY --chown=node:node scripts/eliteenginepro-runtime.mjs ./scripts/
COPY --chown=node:node companion/mt5_sdk_compatibility.py ./companion/
RUN mkdir -p /var/lib/eliteenginepro && chown node:node /var/lib/eliteenginepro && chmod 700 /var/lib/eliteenginepro
USER node
ENV NODE_ENV=production PORT=10000 HOME=/var/lib/eliteenginepro WINEPREFIX=/var/lib/eliteenginepro/wine WINEDEBUG=-all WINEDLLOVERRIDES=mscoree,mshtml= ELITEENGINEPRO_MODE=compatibility
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini","-g","--"]
CMD ["/usr/bin/xvfb-run","--auto-servernum","--server-args=-screen 0 1280x800x24 -nolisten tcp","node","scripts/eliteenginepro-runtime.mjs"]
