/**
 * The whole frontend, inlined. The real repo serves a built React app
 * (@deepseek-ai/dsh-web-frontend) through a static-file fallback instead —
 * but it talks to the backend the same way: POST up, event stream down.
 */
export const PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>mini-dsh</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  #log { border: 1px solid #ccc; border-radius: 6px; padding: 0.75rem; min-height: 300px; }
  .user { color: #0b5394; margin: 0.4rem 0; }
  .assistant { color: #222; margin: 0.4rem 0; }
  .tool { color: #666; font-family: monospace; font-size: 0.85em; margin: 0.2rem 0 0.2rem 1rem; }
  .status { color: #999; font-size: 0.8em; }
  form { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  input { flex: 1; padding: 0.5rem; }
</style>
</head>
<body>
<h1>mini-dsh</h1>
<div id="log"><div class="status">no session yet - send a message to start one</div></div>
<form id="form">
  <input id="input" placeholder="Ask the agent..." autocomplete="off">
  <button>Send</button>
</form>
<script>
  var log = document.getElementById('log')
  var form = document.getElementById('form')
  var input = document.getElementById('input')
  var sessionId = null

  function line(cls, text) {
    var div = document.createElement('div')
    div.className = cls
    div.textContent = text
    log.appendChild(div)
    log.scrollTop = log.scrollHeight
  }

  function flattenText(content) {
    var out = ''
    for (var i = 0; i < content.length; i++) {
      if (content[i].type === 'text') out += content[i].text
    }
    return out
  }

  function subscribe() {
    var source = new EventSource('/api/events?session=' + encodeURIComponent(sessionId))
    source.onmessage = function (message) {
      var event = JSON.parse(message.data)
      if (event.type === 'user/message') line('user', 'you: ' + flattenText(event.data.content))
      if (event.type === 'assistant/message') {
        var text = flattenText(event.data.message.content)
        if (text) line('assistant', 'agent: ' + text)
      }
      if (event.type === 'tool/call') line('tool', '[tool] ' + event.data.name + ' ' + event.data.arguments)
      if (event.type === 'turn/end') line('status', 'turn ended: ' + event.data.reason.kind)
    }
  }

  form.addEventListener('submit', function (submit) {
    submit.preventDefault()
    var text = input.value.trim()
    if (!text) return
    input.value = ''
    fetch('/api/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, text: text }),
    })
      .then(function (response) { return response.json() })
      .then(function (body) {
        if (sessionId === null) {
          sessionId = body.sessionId
          log.innerHTML = ''
          subscribe()
        }
      })
  })
</script>
</body>
</html>
`
