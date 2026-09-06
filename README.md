# Palavra — tradução ao vivo para a igreja

No computador da cabine, o **espaço** escuta o áudio da mesa, traduz e mostra um QR. A plateia **escaneia o código** e lê a tradução no navegador do celular — Android ou iPhone, sem instalar aplicativo.

```
Mesa (AUX/LINE) → computador da igreja → Chrome + servidor Palavra
                                          ↓
                         QR público (Cloudflare)  →  celular com internet
```

## O que você precisa

- Este computador (já tem Node.js)
- Chrome ou Edge no PC da igreja (é ele que ouve o microfone)
- Mesa de som com saída **AUX**, **REC** ou **LINE OUT**
- Cabo ou interface USB para ligar a mesa no computador
- Internet no computador da cabine (para gerar o QR público)
- Internet no celular da plateia (não precisa ser a mesma Wi‑Fi)

## Windows (executável)

No Linux, gere a pasta pronta para o PC da igreja:

```bash
npm run build:win
```

Isso cria `dist-windows/` com `Palavra.exe`, a interface e o `cloudflared.exe`. Copie **a pasta inteira** para o Windows e dê dois cliques em `Palavra.exe`. O programa sobe o servidor, abre o Chrome/Edge e gera o QR. Não precisa instalar Node nem npm nesse computador.

O Windows 10/11 já tem o Edge (reconhecimento de fala). Na primeira execução, se o firewall perguntar, escolha **Permitir**.

## Instalar (primeira vez, no Linux)

No terminal, dentro desta pasta:

```bash
cd /home/pierrot/Documents/translationApp
npm install
```

## Ligar no culto

1. Conecte a saída da mesa na entrada de áudio do computador.
2. No Chrome, confirme que essa entrada é o microfone padrão do sistema.
3. No terminal:

```bash
npm start
```

4. Abra o endereço que aparecer, em geral [http://localhost:3000](http://localhost:3000).
5. Toque em **Abrir o espaço no computador**, siga os 3 passos e **Iniciar**.
6. Permita o microfone quando o Chrome pedir.
7. Mostre o QR. Cada pessoa aponta a câmera e cai na página da tradução.

O QR usa um **link público HTTPS** (túnel Cloudflare). O celular abre mesmo se a Wi‑Fi isolar os aparelhos. O endereço parece `https://….trycloudflare.com/ouvir/IGREJA-A3F2` e muda a cada `npm start`.

## Conectar a mesa no computador

- **Não** ligue o microfone cru sem pré-amplificador. Use a saída de linha da mesa.
- **Windows / Linux:** cabo P2 ou interface USB; em Configurações de som, escolha essa entrada.
- **Mac:** o mesmo, ou adaptador USB‑C.
- Se o som distorcer (estourar), baixe o nível AUX na mesa ou use um atenuador de linha.
- Bluetooth vale se o computador enxergar o transmissor como microfone.

O reconhecimento de fala usa a entrada ativa do sistema. Quando o cabo está conectado e selecionado, o Chrome ouve a mesa — não o microfone interno.

## Se o celular não abrir o QR

Espere o QR virar um endereço `https://….trycloudflare.com`. Isso leva alguns segundos após o `npm start`.

- O celular precisa de internet (Wi‑Fi ou dados).
- Se o QR ainda mostrar `192.168…`, o túnel não subiu — confira a internet do PC e reinicie com `npm start`.
- Para forçar só a rede local: `PALAVRA_NO_TUNNEL=1 npm start`.
- Desenvolvimento no próprio PC: `npm run dev`. No culto, use `npm start`.

## Idiomas

Padrão: português → inglês. No espaço dá para ouvir e traduzir em português, inglês, espanhol e italiano.

A transcrição é gratuita (Web Speech API do Chrome). A tradução usa a API gratuita MyMemory, com um glossário curto de palavras de culto se a rede falhar.

## Estrutura

```
server/   Express + Socket.IO + tradução
web/      Páginas: início, espaço (cabine) e ouvir (celular)
```

## Depois desta versão

- Whisper no próprio PC, para entender melhor o sermão
- Vários idiomas ao mesmo tempo
- Histórico do culto
