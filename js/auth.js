
const SUPABASE_URL = 'https://otdwyajhwgenykjdeynv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_KhvLPkG-7NYLRlEFUhnkJw_-HEFJN1g';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const tabs = document.querySelectorAll('.tab');
const forms = { entrar: document.getElementById('form-entrar'), criar: document.getElementById('form-criar') };
const mensagem = document.getElementById('mensagem');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('ativa'));
    tab.classList.add('ativa');
    Object.values(forms).forEach((f) => f.classList.remove('ativa'));
    forms[tab.dataset.tab].classList.add('ativa');
    esconderMensagem();
  });
});

function mostrarMensagem(texto, tipo) {
  mensagem.textContent = texto;
  mensagem.className = `mensagem ${tipo}`;
}
function esconderMensagem() {
  mensagem.className = 'mensagem';
}

forms.entrar.addEventListener('submit', async (e) => {
  e.preventDefault();
  esconderMensagem();
  const email = document.getElementById('entrar-email').value;
  const senha = document.getElementById('entrar-senha').value;

  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) {
    mostrarMensagem('E-mail ou senha incorretos.', 'erro');
    return;
  }
  window.location.href = '/dashboard.html';
});

forms.criar.addEventListener('submit', async (e) => {
  e.preventDefault();
  esconderMensagem();
  const nome = document.getElementById('criar-nome').value;
  const telefone = document.getElementById('criar-telefone').value.replace(/\D/g, '');
  const email = document.getElementById('criar-email').value;
  const senha = document.getElementById('criar-senha').value;

  const { error } = await supabase.auth.signUp({
    email,
    password: senha,
    options: { data: { nome, papel: 'gestor', telefone_whatsapp: telefone } },
  });

  if (error) {
    mostrarMensagem('Não foi possível criar a conta: ' + error.message, 'erro');
    return;
  }
  mostrarMensagem('Conta criada! Verifique seu e-mail para confirmar, depois faça login.', 'sucesso');
});