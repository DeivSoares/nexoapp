# Firebase Authentication e Firestore

O Nexo autentica por usuário e senha usando diretamente o Firebase Authentication e salva os dados do app no Cloud Firestore. Cada empresa tem um `companyId`; contas vinculadas ao mesmo identificador compartilham clientes, financeiro, serviços, atividades e equipe. Empresas com identificadores diferentes permanecem isoladas. A configuração funciona no plano Spark, sem Cloud Functions, App Check ou plano Blaze.

## Configurar o Firebase no plano Spark

1. No [Firebase Console](https://console.firebase.google.com/), crie ou selecione o projeto gratuito.
2. Em **Authentication → Sign-in method**, habilite **E-mail/senha**.
3. Em **Firestore Database**, crie um banco de dados no modo de produção. O Firestore tem cota gratuita no plano Spark; não habilite o Blaze para seguir estes passos.
4. Na aba **Regras** do Firestore, substitua as regras existentes pelo conteúdo completo de [`firestore.rules`](./firestore.rules) e clique em **Publicar**. As regras exigem um vínculo por UID em `companyMemberships` e autorizam o acesso somente aos dados da empresa desse vínculo.
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

`canManageUsers: true` autoriza a conta a criar outros logins. Essa permissão deve ser concedida pelo Console do Firebase, não pelo formulário do Nexo. Nunca conceda esse campo a um usuário comum.

## Criar contas para a equipe

Na aba **Equipe → Adicionar pessoa**, informe nome, usuário, senha inicial (mínimo de 6 caracteres), e-mail de contato opcional e função. O Nexo cria uma conta no Firebase Authentication, salva o membro na equipe compartilhada e cria `companyMemberships/{UID}` com o mesmo `companyId`, `active: true` e `canManageUsers: false`. A senha é enviada ao Firebase Auth e não é armazenada nos dados da equipe.

Os nomes de usuário são normalizados para minúsculas e aceitam de 3 a 64 caracteres: letras sem acento, números, ponto, hífen ou sublinhado. São únicos no projeto. Se a criação da associação falhar, o app tenta remover a conta recém-criada; se não conseguir, exibirá instruções para remover o usuário órfão em **Authentication → Users**.

As contas criadas por essa tela não recebem e-mail de recuperação, porque usam e-mails técnicos. O administrador deve redefinir senhas pelo Firebase Console. A função escolhida na equipe é informativa; ainda não restringe as outras telas do app.

### Vincular contas que já existem

Para cada conta existente criada diretamente no Firebase Console, crie/edite `companyMemberships/{UID}` com `companyId` igual ao da empresa, `active: true` e `canManageUsers: false`. Para permitir que uma conta existente gerencie cadastros, o administrador pode definir `canManageUsers: true` manualmente no Console.

O ID do documento deve ser o UID exato da conta, e a coleção `companyMemberships` fica no nível principal do Firestore, ao lado de `companies` e `nexoUsers`.

### Contas que já existiam

Para preservar o UID e os dados locais de uma conta existente, o administrador pode alterar o e-mail dessa conta no Firebase Authentication para o e-mail técnico correspondente ao nome de usuário. Depois, vincule o UID em `companyMemberships`.

**Limitação dos e-mails técnicos:** eles não recebem mensagens. Recuperação de senha por e-mail e verificação de endereço não funcionarão para esses endereços; o administrador deve trocar a senha pelo Firebase Console. Se o usuário precisar de e-mail de recuperação ou verificação, será necessário usar um e-mail real como login ou desenvolver um fluxo administrativo alternativo.

## Executar

```powershell
npm install
npm start
```

Abra o endereço local que o Vite mostrar, normalmente `http://127.0.0.1:5173/login.html`. Se alterar `.env.local`, reinicie o servidor.

Os dados de cada empresa são salvos no documento `companies/{companyId}/data/main` e sincronizados em tempo real com as contas vinculadas à empresa. No primeiro acesso, se esse documento ainda não existir, o app migra os dados antigos de `nexoUsers/{uid}` ou os dados locais daquele navegador. Se não houver dados anteriores, a empresa começa vazia. Crie primeiro o vínculo do administrador e faça seu primeiro login antes de vincular outras contas a uma empresa existente, para que os dados legados sejam migrados para o local compartilhado. Dados locais e documentos legados não são apagados do Firestore pela migração.

Se aparecer `Missing or insufficient permissions`, publique as regras atuais de [`firestore.rules`](./firestore.rules) no mesmo projeto do `projectId` em `.env.local`. Para entrar, confirme que existe `companyMemberships/{UID}` com `companyId` string e `active: true`; para criar contas na aba Equipe, também é necessário `canManageUsers: true`. Não use regras abertas para corrigir o erro. O limite de tamanho do Firestore por documento é 1 MiB; para volumes maiores, será necessário migrar as listas para coleções separadas.
