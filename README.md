# Emprestei — V1 Fintech

Aplicação mobile-first para controle de empréstimos particulares.

## V1

- Dashboard financeiro premium
- Caixa disponível
- Total emprestado
- Total a receber
- Lucro previsto
- Clientes e WhatsApp
- Empréstimos e vencimentos
- Status: em aberto, vence hoje, atrasado e pago
- Registro rápido de pagamento
- Persistência local para a versão inicial
- Estrutura preparada para Supabase
- Schema com RLS por usuário em `supabase/migrations/001_initial_schema.sql`

## Rodar localmente

```bash
npm install
npm run dev
```

## Produção com Supabase

Copie `.env.example` para `.env` e informe a URL e a publishable key do projeto Supabase. O schema inicial está versionado no repositório.
