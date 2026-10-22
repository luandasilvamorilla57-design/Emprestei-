# Emprestei

V1 de um painel financeiro mobile-first para controle particular de dinheiro emprestado.

## O que já funciona

- Login e cadastro com Supabase Auth
- Dashboard com caixa disponível, capital emprestado, saldo a receber, recebido, lucro previsto e atrasos
- Cadastro de clientes com WhatsApp
- Cadastro de empréstimos para cliente novo ou existente
- Valor emprestado, valor a receber e vencimento
- Pagamentos parciais ou quitação total
- Atualização automática do caixa após recebimentos
- Abertura do WhatsApp com mensagem de cobrança preenchida
- Busca de clientes
- Status Em aberto, Vence hoje, Atrasado e Pago
- Interface responsiva com animações e navegação estilo fintech
- Banco com RLS por usuário

## Stack

- React + TypeScript + Vite
- Supabase Auth + Postgres
- Framer Motion
- Lucide React

## Banco

Projeto Supabase: `Emprestei`

As tabelas principais são `profiles`, `cash_accounts`, `clients`, `loans` e `payments`. A migration inicial está em `supabase/migrations/001_initial_schema.sql`.

## Rodar localmente

```bash
npm ci
npm run dev
```

As variáveis públicas do frontend estão documentadas em `.env.example`.

## Validação

O workflow `.github/workflows/ci.yml` instala as dependências e executa `npm run build` a cada atualização da branch `main`.
