const SUPABASE_URL = 'https://otdwyajhwgenykjdeynv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_KhvLPkG-7NYLRlEFUhnkJw_-HEFJN1g';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Se já existe uma sessão salva (login anterior), pula direto pro dashboard
supabaseClient.auth.getSession().then(({ data }) => {
  if (data.session) {
    window.location.href = 'dashboard.html';
  }
});

const formEntrar = document.getElementById('form-entrar');
const mensagem = document.getElementById('mensagem');

function mostrarMensagem(texto, tipo) {
  mensagem.textContent = texto;
  mensagem.className = `mensagem ${tipo}`;
}
function esconderMensagem() {
  mensagem.className = 'mensagem';
}

formEntrar.addEventListener('submit', async (e) => {
  e.preventDefault();
  esconderMensagem();
  const email = document.getElementById('entrar-email').value;
  const senha = document.getElementById('entrar-senha').value;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
  if (error) {
    mostrarMensagem('E-mail ou senha incorretos.', 'erro');
    return;
  }
  window.location.href = 'dashboard.html';
});