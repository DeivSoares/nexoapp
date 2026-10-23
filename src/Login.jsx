import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import { firebaseAuth, firebaseConfigured } from "./firebase.js";
import { usernameToFirebaseEmail } from "./auth.js";

function getLoginError(error) {
  if (error.code === "auth/too-many-requests") {
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }
  if (error.code === "auth/network-request-failed") {
    return "Não foi possível conectar ao Firebase. Verifique sua conexão.";
  }
  if (error.code === "auth/invalid-api-key" || error.code === "auth/configuration-not-found") {
    return "A configuração do Firebase está incorreta. Peça ao administrador para revisá-la.";
  }
  if (error.code === "auth/operation-not-allowed") {
    return "O login por e-mail e senha não está habilitado no Firebase.";
  }
  return "Usuário ou senha inválidos. Confira seus dados e tente novamente.";
}

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!firebaseConfigured || !firebaseAuth) return undefined;
    return onAuthStateChanged(firebaseAuth, (user) => {
      if (user) window.location.replace("/");
    }, (authError) => {
      console.error("Não foi possível verificar a sessão do Firebase.", authError);
      setError("Não foi possível verificar a sessão. Recarregue a página e tente novamente.");
    });
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!firebaseAuth) return;
    setError("");
    setLoading(true);

    try {
      const email = usernameToFirebaseEmail(username, import.meta.env.VITE_FIREBASE_PROJECT_ID);
      await signInWithEmailAndPassword(firebaseAuth, email, password);
      window.location.replace("/");
    } catch (authError) {
      console.error("Falha ao autenticar no Firebase.", authError);
      setError(getLoginError(authError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-brand-panel" aria-label="Nexo Gestão">
        <a className="brand login-brand" href="/" aria-label="Nexo, início">
          <span className="brand-mark">N</span>
          <span className="brand-copy"><strong>Nexo</strong><small>GESTÃO</small></span>
        </a>
        <div className="login-brand-message">
          <span className="login-kicker">SUA OPERAÇÃO, CONECTADA</span>
          <h1>Gestão clara.<br />Decisões melhores.</h1>
          <p>Clientes, financeiro, serviços e equipe em um só lugar.</p>
        </div>
        <span className="login-brand-footer">Nexo Gestão · DvS Web</span>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="login-heading">
            <span className="eyebrow">BEM-VINDO DE VOLTA</span>
            <h2>Acesse sua conta</h2>
            <p>Use o usuário e a senha fornecidos pelo administrador.</p>
          </div>
          <form className="login-form" onSubmit={handleSubmit}>
            <label className="login-field" htmlFor="login-username">Usuário
              <input id="login-username" type="text" autoComplete="username" placeholder="seu.usuario" minLength={3} maxLength={64} required value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label className="login-field" htmlFor="login-password">Senha
              <span className="password-control">
                <input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Digite sua senha" required value={password} onChange={(event) => setPassword(event.target.value)} />
                <button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword}>{showPassword ? "Ocultar" : "Mostrar"}</button>
              </span>
            </label>
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="button button-primary login-submit" type="submit" disabled={!firebaseConfigured || loading}>{loading ? "Entrando..." : "Entrar no Nexo"}</button>
          </form>
          <p className="login-access-note"><span aria-hidden="true">♙</span> O acesso é criado e gerenciado pelo administrador.</p>
          {!firebaseConfigured && <p className="login-setup-note">O Firebase ainda não foi configurado. O administrador precisa preencher as variáveis VITE_FIREBASE_* no arquivo .env.local e reiniciar o app.</p>}
        </div>
        <footer className="login-footer">© {new Date().getFullYear()} Nexo Gestão</footer>
      </section>
    </main>
  );
}
