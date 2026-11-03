#!/usr/bin/env python3
"""Servidor do app de treino.

Só biblioteca padrão (roda igual no Windows do Ryzen e no Arch).
Guarda tudo numa tabela SQLite de registros genéricos com "última escrita
vence" (updated_at), o que permite sincronizar duas máquinas sem conflito:
cada uma manda para a outra o que mudou.

    python server.py                      # porta 8790, todas as interfaces
    TREINO_PEER=http://100.98.151.43:8790 python server.py   # sincroniza com o par
"""
import json
import os
import socket
import sqlite3
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
DB_PATH = Path(os.environ.get("TREINO_DB", BASE / "dados" / "treino.db"))
PORTA = int(os.environ.get("TREINO_PORTA", "8790"))
PEER = os.environ.get("TREINO_PEER", "").rstrip("/")
INTERVALO_SYNC = int(os.environ.get("TREINO_SYNC_S", "60"))
NO = os.environ.get("TREINO_NO", socket.gethostname())

_trava = threading.Lock()


def conectar():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.execute(
        """CREATE TABLE IF NOT EXISTS registros (
               id TEXT PRIMARY KEY,
               tipo TEXT NOT NULL,
               perfil TEXT,
               dados TEXT NOT NULL,
               updated_at REAL NOT NULL,
               apagado INTEGER NOT NULL DEFAULT 0,
               recebido_em REAL NOT NULL
           )"""
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_recebido ON registros(recebido_em)")
    con.commit()
    return con


CON = conectar()


def listar(desde=0.0):
    with _trava:
        linhas = CON.execute(
            "SELECT id, tipo, perfil, dados, updated_at, apagado FROM registros "
            "WHERE recebido_em > ? ORDER BY updated_at",
            (desde,),
        ).fetchall()
    return [
        {"id": i, "tipo": t, "perfil": p, "dados": json.loads(d), "updated_at": u, "apagado": bool(a)}
        for i, t, p, d, u, a in linhas
    ]


def gravar(registros):
    """Upsert com última escrita vence. Retorna quantos mudaram."""
    agora = time.time()
    mudou = 0
    with _trava:
        for r in registros:
            if not r.get("id") or not r.get("tipo"):
                continue
            atual = CON.execute("SELECT updated_at FROM registros WHERE id=?", (r["id"],)).fetchone()
            if atual and atual[0] >= r["updated_at"]:
                continue
            CON.execute(
                "INSERT OR REPLACE INTO registros VALUES (?,?,?,?,?,?,?)",
                (
                    r["id"],
                    r["tipo"],
                    r.get("perfil"),
                    json.dumps(r.get("dados", {}), ensure_ascii=False),
                    float(r["updated_at"]),
                    1 if r.get("apagado") else 0,
                    agora,
                ),
            )
            mudou += 1
        CON.commit()
    return mudou


def sincronizar_com_par():
    """Troca registros com o outro servidor (Ryzen <-> Arch) periodicamente."""
    ultimo_recebido = 0.0
    ultimo_enviado = 0.0
    while True:
        try:
            with urllib.request.urlopen(f"{PEER}/api/registros?desde={ultimo_recebido}", timeout=10) as r:
                resp = json.load(r)
            gravar(resp["registros"])
            ultimo_recebido = resp["agora"]

            inicio = time.time()
            meus = listar(ultimo_enviado)
            if meus:
                req = urllib.request.Request(
                    f"{PEER}/api/registros",
                    data=json.dumps(meus).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urllib.request.urlopen(req, timeout=10).read()
            ultimo_enviado = inicio
        except Exception as e:  # par desligado é o caso normal
            print(f"[sync] par indisponível: {e.__class__.__name__}", flush=True)
        time.sleep(INTERVALO_SYNC)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(STATIC), **kw)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, obj, status=200):
        corpo = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/registros":
            desde = float(parse_qs(url.query).get("desde", ["0"])[0])
            agora = time.time()
            return self._json({"agora": agora, "registros": listar(desde)})
        if url.path == "/api/info":
            return self._json({"no": NO, "agora": time.time(), "par": PEER or None})
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/registros":
            return self._json({"erro": "rota desconhecida"}, 404)
        tamanho = int(self.headers.get("Content-Length", 0))
        try:
            registros = json.loads(self.rfile.read(tamanho) or b"[]")
            if isinstance(registros, dict):
                registros = [registros]
            return self._json({"gravados": gravar(registros)})
        except (ValueError, KeyError, TypeError) as e:
            return self._json({"erro": str(e)}, 400)


def main():
    if PEER:
        threading.Thread(target=sincronizar_com_par, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORTA), Handler)
    print(f"Treino rodando em http://0.0.0.0:{PORTA}  (nó {NO}, banco {DB_PATH}, par {PEER or '-'})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
