# Graphify para análise local

O Graphify pode mapear as relações do servidor TypeScript e ajudar a localizar pontos de entrada antes de mudanças. A instalação é opcional para quem usa o Godot DevPilot; ela serve apenas para desenvolvimento deste repositório.

Instale o pacote oficial `graphifyy` (dois `y`) em Python 3.10+ com `uv tool install graphifyy` ou `python -m pip install --user graphifyy`. O comando `graphify` pode não entrar automaticamente no `PATH` no Windows; `python -m graphify` funciona sem essa alteração.

Na raiz do repositório:

```bash
python -m graphify . --code-only --no-viz
python -m graphify cluster-only . --no-label --no-viz
python -m graphify query "How does MCP startup validate the project root?"
python -m graphify explain "resolveProjectPath()"
```

Os resultados ficam em `graphify-out/`, ignorado pelo Git. Depois de alterar o código, rode `python -m graphify update .` e `python -m graphify cluster-only . --no-label --no-viz` para atualizar o relatório. Para uma visualização interativa, rode `python -m graphify export html` e abra `graphify-out/graph.html`.

Na análise inicial, o Graphify gerou 1.190 nós e 4.192 relações; a atualização posterior incluiu mais conteúdo do repositório. **Os arquivos GDScript (`.gd`) não foram classificados nessa execução**, então o grafo não cobre o plugin Godot. Faça a revisão do lado Godot diretamente nos arquivos `addons/godot_devpilot_mcp/` e valide as mudanças no editor. As relações inferidas pelo grafo servem como pistas; confirme o comportamento no código e nos testes.

Referência: [Graphify, guia oficial](https://github.com/Graphify-Labs/docs/blob/main/quickstart.mdx).
