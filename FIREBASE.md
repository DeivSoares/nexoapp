# Firebase Authentication e Firestore

O Nexo autentica por usuário e senha usando diretamente o Firebase Authentication e salva os dados do app no Cloud Firestore. Cada empresa tem um `companyId`; contas vinculadas ao mesmo identificador compartilham clientes, financeiro, serviços, atividades e equipe. Os serviços de catálogo são documentos separados em `companies/{companyId}/services/{serviceId}`. Empresas com identificadores diferentes permanecem isoladas. A configuração funciona no plano Spark, sem Cloud Functions, App Check ou plano Blaze.

## Configurar o Firebase no plano Spark

1. No [Firebase Console](https://console.firebase.google.com/), crie ou selecione o projeto gratuito.
2. Em **Authentication → Sign-in method**, habilite **E-mail/senha**.
3. Em **Firestore Database**, crie um banco de dados no modo de produção. O Firestore tem cota gratuita no plano Spark; não habilite o Blaze para seguir estes passos.
4. Na aba **Regras** do Firestore, substitua as regras existentes pelo conteúdo completo de [`firestore.rules`](./firestore.rules) e clique em **Publicar**. As regras exigem um vínculo por UID em `companyMemberships` e autorizam o acesso somente aos dados da empresa desse vínculo. As regras atuais também permitem que cada conta altere somente sua própria URL de foto (`photoUrl`) no vínculo.
5. Em **Configurações do projeto → Seus apps**, registre um app Web.
6. Copie a configuração do app Web para `.env.local`. O projeto atual tem um exemplo em `.env.example`; confirme que o `projectId` corresponde ao projeto desejado.

Na raiz do projeto, crie o arquivo local:

```powershell
Copy-Item .env.example .env.local
```

As variáveis `VITE_FIREBASE_*` do `.env.local` são a configuração pública do app Web. Não coloque senhas de usuário, service accounts ou credenciais administrativas nesse arquivo.

## Configurar o administrador da empresa

1. Crie a primeira conta em **Authentication → Users → Add user**. O e-mail Firebase é técnico e tem o formato `<usuario>@<projectId>.firebaseapp.com`; o administrador entra no Nexo usando somente o nome de usuário e a senha.
2. Copie o UID da conta em **Authentication → Users**.
3. Em **Firestore Database → Dados**, crie/edite `companyMemberships/{UID}` com estes campos:
   - `companyId` (string): identificador da empresa, por exemplo `dvs-web`.
   - `active` (boolean): `true`.
   - `canManageUsers` (boolean): `true`.
4. Entre no Nexo com essa conta. O app inicializa os dados da empresa ou migra os dados legados existentes.

`canManageUsers: true` autoriza a conta a criar outros logins. Essa permissão inicial do primeiro administrador deve ser concedida pelo Console do Firebase uma única vez. Depois, administradores autorizados podem criar novos membros com a permissão preenchida automaticamente conforme a função escolhida.

## Criar contas para a equipe

Na aba **Equipe → Adicionar pessoa**, informe nome, usuário, senha inicial (mínimo de 6 caracteres), e-mail de contato opcional e função. O Nexo cria uma conta no Firebase Authentication, salva o membro na equipe compartilhada e cria `companyMemberships/{UID}` automaticamente com o mesmo `companyId`, `active: true` e `usuario` preenchido com o nome informado. `canManageUsers` também é definido automaticamente: `true` para a função **Administrador**, `false` para as outras funções. Assim é possível localizar o vínculo pelo UID no Firestore e ver o nome do membro. Não é necessário criar ou editar o vínculo de cada novo membro pelo Console. Depois de mudar o código ou as regras, publique ambos: regras no Firebase Console e a nova versão compilada do app no GitHub Pages.

O usuário que realiza o cadastro precisa ter `canManageUsers: true` no próprio vínculo. A permissão inicial do administrador da empresa deve ser concedida pelo Console uma única vez; usuários comuns não podem concedê-la a si mesmos. Os nomes de usuário são normalizados para minúsculas e aceitam de 3 a 64 caracteres: letras sem acento, números, ponto, hífen ou sublinhado. São únicos no projeto. Se a criação da associação falhar, o app tenta remover a conta recém-criada; se não conseguir, exibirá instruções para remover o usuário órfão em **Authentication → Users**.

As contas criadas por essa tela não recebem e-mail de recuperação, porque usam e-mails técnicos. O administrador deve redefinir senhas pelo Firebase Console. A função **Administrador** permite criar usuários; as funções não restringem o acesso às outras telas do app.

Ao remover um membro criado pelo Nexo, o app exclui em uma transação o registro da equipe e `companyMemberships/{UID}`. A pessoa perde acesso aos dados da empresa e a sessão aberta é encerrada quando o Firestore detecta a remoção. A conta de autenticação permanece em **Authentication → Users** e pode ser excluída manualmente pelo administrador; a exclusão de outras contas do Firebase Authentication exige acesso administrativo de servidor e não é feita pelo app web. Membros antigos sem UID salvo podem ser removidos da lista, mas precisam ter o vínculo e a conta revogados manualmente no Console.

### Vincular contas que já existem

Para cada conta existente criada diretamente no Firebase Console, crie/edite `companyMemberships/{UID}` com `companyId` igual ao da empresa, `active: true` e `canManageUsers: false`. Para permitir que uma conta existente gerencie cadastros, o administrador pode definir `canManageUsers: true` manualmente no Console.

O ID do documento deve ser o UID exato da conta, e a coleção `companyMemberships` fica no nível principal do Firestore, ao lado de `companies` e `nexoUsers`.

## Nome, privilégio e foto no perfil

Na aba **Serviços**, cada serviço é cadastrado como um documento separado em `companies/{companyId}/services/{serviceId}` e fica compartilhado entre as contas da empresa. O cadastro do serviço inclui nome, tipo, mensalidade, valor fixo/de entrada e status; não inclui cliente nem data de renovação. Ao cadastrar um cliente, selecione um serviço do catálogo. A seleção preenche os valores, que podem ser ajustados para aquele cliente. Clientes antigos continuam exibindo o serviço já salvo.

No Sidebar, o Nexo exibe o nome registrado para a pessoa na aba Equipe ou o campo `usuario` do vínculo `companyMemberships/{UID}`. A função da pessoa é exibida como privilégio; se não houver registro de equipe, o app usa **Administrador** quando `canManageUsers` for `true` e **Membro** nos demais casos. Para uma conta vinculada manualmente, preencha `usuario` com o nome que deseja exibir.

Clique no nome ou no avatar do Sidebar para informar uma URL pública da imagem. O valor é salvo no campo `photoUrl` do vínculo daquela conta; deixe o campo vazio para remover a foto. Use uma URL direta `http://` ou `https://` com no máximo 2048 caracteres. Para aplicar esta edição em um projeto já configurado, publique também as regras atualizadas de [`firestore.rules`](./firestore.rules) no Console do Firebase e publique a nova versão do app.

### Contas que já existiam

Para preservar o UID e os dados locais de uma conta existente, o administrador pode alterar o e-mail dessa conta no Firebase Authentication para o e-mail técnico correspondente ao nome de usuário. Depois, vincule o UID em `companyMemberships`.

**Limitação dos e-mails técnicos:** eles não recebem mensagens. Recuperação de senha por e-mail e verificação de endereço não funcionarão para esses endereços; o administrador deve trocar a senha pelo Firebase Console. Se o usuário precisar de e-mail de recuperação ou verificação, será necessário usar um e-mail real como login ou desenvolver um fluxo administrativo alternativo.

## Publicar no GitHub Pages

O repositório `DeivSoares/nexoapp` inclui um workflow que compila o React e publica a pasta `dist` no caminho `/nexoapp/`. Para ativar:

1. No GitHub, abra **DeivSoares/nexoapp → Settings → Secrets and variables → Actions → Variables**.
2. Crie as variáveis do tipo **Repository variable** com os valores de configuração do app Web do Firebase:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
3. Em **Settings → Pages**, selecione **GitHub Actions** como fonte de publicação.
4. Em **Firebase Console → Authentication → Settings → Authorized domains**, adicione `deivsoares.github.io` (somente o domínio, sem `https://` nem `/nexoapp`).
5. Envie um commit para a branch `main` ou execute manualmente o workflow **Deploy GitHub Pages** em **Actions**.

O endereço do app será `https://deivsoares.github.io/nexoapp/`. O workflow falha claramente se faltar qualquer variável Firebase obrigatória, em vez de publicar uma tela sem configuração. A configuração Web do Firebase é destinada ao cliente; não coloque senhas de contas, service accounts ou credenciais administrativas nas variáveis `VITE_*`.

## Executar

```powershell
npm install
npm start
```

Abra o endereço local que o Vite mostrar, normalmente `http://127.0.0.1:5173/login.html`. Se alterar `.env.local`, reinicie o servidor.

Os dados de cada empresa são salvos no documento `companies/{companyId}/data/main` e sincronizados em tempo real com as contas vinculadas à empresa. No primeiro acesso, se esse documento ainda não existir, o app migra os dados antigos de `nexoUsers/{uid}` ou os dados locais daquele navegador. Se não houver dados anteriores, a empresa começa vazia. Crie primeiro o vínculo do administrador e faça seu primeiro login antes de vincular outras contas a uma empresa existente, para que os dados legados sejam migrados para o local compartilhado. Dados locais e documentos legados não são apagados do Firestore pela migração.

Se aparecer `Missing or insufficient permissions`, publique as regras atuais de [`firestore.rules`](./firestore.rules) no mesmo projeto do `projectId` em `.env.local`. Para entrar, confirme que existe `companyMemberships/{UID}` com `companyId` string e `active: true`; para criar contas na aba Equipe, a conta que está cadastrando também precisa ter `canManageUsers: true`. Novos usuários recebem essa permissão automaticamente quando cadastrados com a função Administrador. Não use regras abertas para corrigir o erro. O limite de tamanho do Firestore por documento é 1 MiB; para volumes maiores, será necessário migrar as listas para coleções separadas.
