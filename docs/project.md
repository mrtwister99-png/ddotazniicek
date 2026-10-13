# PROJECT.md — aplikace pro ankety, úkoly a zpětnou vazbu

> Stav dokumentu: návrh V1  
> Cíl: předatelná specifikace pro vývojáře / kolegu  
> Platformy: iOS + Android, telefon jako primární zařízení  
> Klient: Expo SDK 54 + React Native + TypeScript

## 1. Jednou větou

Admin vytváří šablony krátkých formulářů, posílá je jednotlivcům, skupinám nebo všem uživatelům a v reálném čase dostává jejich odpovědi; uživatel obdrží push notifikaci, otevře přes ni konkrétní formulář, vyplní ho a získá body.

Primární použití je sběr zpětné vazby od kamarádů. Aplikace ale musí být připravená i pro veřejnou instalaci z Google Play a App Store.

## 2. Role a bezpečný vstup

### Owner / jediný admin

- Existuje právě jeden owner: zakladatel aplikace.
- Owner se nikdy nepovýší podle běžné registrace ani prvního otevření aplikace.
- Owner se přihlásí přes prázdné pole přezdívky a tajný kód zadaný jako heslo.
  `ADMIN_LOGIN_SECRET` je pouze v serverových Supabase Secrets, nikdy v klientu
  ani v commitnutém `.env`.
- Edge Function při prvním úspěšném tajném přihlášení vytvoří interní Supabase
  Auth identitu s e-mailem odvozeným z hashe secretu pod rezervovanou doménou
  `.invalid`; tato identita se nikde v UI nezadává. Privilegovaná serverová
  operace naváže jediný owner účet na jeho Auth UUID.
- Owner účet se automaticky nevytváří jen při otevření aplikace. Tajný kód se
  přijímá pouze při prázdném identifikátoru; pokud je identifikátor vyplněný,
  probíhá běžné přihlášení e-mailem/přezdívkou a heslem.
- Jen owner může spravovat uživatele, skupiny, šablony, rozesílky, výsledky a body.

### Běžný uživatel

- Každý si vytvoří účet: e-mail, unikátní přezdívka, heslo.
- Přihlásí se e-mailem **nebo** přezdívkou a heslem.
- E-mail je vždy povinný kvůli obnově účtu a ověření vlastnictví.
- Přezdívka je veřejný zobrazovaný identifikátor, nesmí obsahovat citlivé údaje a je unikátní bez ohledu na velká/malá písmena.
- V produkci je vhodné přidat registraci přes pozvánku / QR kód. Veřejná registrace může zůstat zapnutá, ale s ověřením e-mailu a anti-spam limitem.

### Přihlášení přezdívkou — technická poznámka

Supabase Auth nativně přihlašuje e-mailem. Obrazovka může přijmout „e-mail nebo přezdívku“, ale převod přezdívky na e-mail musí proběhnout v zabezpečené Supabase Edge Function `login-with-identifier`. Klient nesmí mít přístup k seznamu e-mailů jiných lidí. Funkce musí mít rate limit, obecnou chybovou hlášku a nesmí logovat heslo.

## 3. Funkční scope V1

### Uživatel

1. Registrace, ověření e-mailu, přihlášení, odhlášení a obnova hesla.
2. Domovská obrazovka ukazuje pouze aktivní formuláře určené konkrétnímu uživateli.
3. Zelená „siréna“ znamená žádný nový úkol; červeně blikající znamená nový nepřečtený úkol.
4. Siréna má také slovní stav (`Žádný nový úkol` / `Nový úkol čeká`) — barva ani animace nesmí být jediný signál.
5. Po kliknutí na úkol otevře formulář, může uložit koncept a odpověď odeslat.
6. Po odeslání vidí potvrzení a svůj aktuální počet bodů.
7. Push notifikace otevře přímo konkrétní úkol.

### Admin

1. Dashboard: počet aktivních rozesílek, počet čekajících odpovědí, nově odeslané odpovědi a přehled bodů.
2. Seznam uživatelů: hledání, filtrování podle skupiny, vícenásobný výběr, barva, badge, pořadí a skupiny.
3. Šablony: vytvoření, editace, duplikace, náhled a archivace.
4. Rozesílka: vybrat jednu šablonu a jednotlivce, skupiny nebo všechny uživatele; zobrazit souhrn před odesláním.
5. Výsledky: počet odpovědí, detail odpovědi, rozdělení škálových hodnot a možnost filtrovat podle šablony či skupiny. Detail ukáže původní odpověď, poslední opravu a čas opravy.
6. Okamžitá admin notifikace po odeslání i opravě odpovědi s deep linkem na daný výsledek.

## 4. Formuláře a šablony

### První podporované bloky

| Blok | Použití | V1 |
| --- | --- | --- |
| Nadpis / text | Instrukce a otázka | Ano |
| Škála 0–10 | Např. „Jak jste byli během dne spokojeni?“ | Ano |
| Krátká textová odpověď | Volitelný komentář | Ano |
| Obrázek | Kontext otázky | Ano, přes Supabase Storage |
| Volba z možností | Jedna / více odpovědí | V1.1 |
| Datum, soubor, video | Rozšířené vstupy | Mimo V1 |

### Příklad šablony

```text
Název: Denní spokojenost
Viditelný nadpis: Jak jste byli během dne spokojeni?
Blok 1: škála 0–10, povinná
Blok 2: krátký komentář, nepovinný
Body za odeslání: 5
```

### Editor šablony

- Výchozí obsah je nadpis + jedna otázka.
- Tlačítko `+ Přidat blok` nabídne text, škálu, krátký text a obrázek.
- Každý blok jde přesunout, upravit, smazat a označit jako povinný.
- Tlačítko `Test` otevře náhled přesně jako pro uživatele.
- Náhled nesmí ztratit rozpracovanou šablonu: zavře editor vizuálně, ale koncept zůstává lokálně zachovaný; návrat pokračuje v editaci.
- Odeslat lze pouze uloženou a validní šablonu.

## 5. Klíčové uživatelské toky

### A. Registrace uživatele

```text
Instalace → Registrace → e-mail + přezdívka + heslo
→ potvrzení e-mailu → povolit notifikace → Domů
```

Notifikační oprávnění se žádá až po vysvětlení přínosu: „Pošleme ti upozornění jen na nový formulář, který je určený pro tebe.“

### B. Admin odešle formulář

```text
Admin → Šablony → vytvořit/upravit → Test → uložit
→ Uživatelé → vybrat jednoho/skupinu/všechny
→ kontrolní souhrn → Odeslat
→ vzniknou individuální doručení + push notifikace
```

### C. Uživatel odpoví

```text
Push notifikace → deep link → autentizace, pokud je potřeba
→ detail doručení → vyplnění → validace → odeslat
→ připsat body pouze poprvé → potvrzení + „Opravit odpověď“
→ volitelná reklama → admin push
```

Po odeslání může uživatel otevřít stejný formulář s poslední odpovědí
předvyplněnou a znovu ho odeslat. Původní odpověď zůstává neměnná; každá
oprava se přidá jako nový verzovaný záznam. Oprava nepřidává body.

### D. Admin čte výsledky

```text
Admin push → detail výsledku
nebo Dashboard → Výsledky → rozesílka → odpověď uživatele
```

## 6. Navigace a obrazovky

### Auth stack

- `welcome`
- `login`

## 7. Forward migration for the mobile client

The mobile-support schema is added only in
`supabase/migrations/20261013000000_mobile_client_support.sql`. The applied
initial migration remains unchanged. Local database tests apply app-schema
migrations in timestamp order and exclude the optional `pg_cron` scheduling
migration.

Before an operator applies the forward migration, compare the live schema
read-only with the repository's expected migration contract and stop if there
is drift. The migration checks for users with more than one explicit folder
membership before adding the unique membership index. If it finds a conflict,
it aborts without changing memberships; an operator must review and resolve the
conflicting memberships explicitly before retrying.

The migration adds a constrained template category (`questionnaire`,
`advertisement`, or `special_questionnaire`), durable profile/folder favorites,
and the owner-only `move_users_to_group` RPC. A null destination removes
explicit memberships and places selected users in the virtual `Obecná` folder.
Non-owners cannot change profile favorites or use the RPC to move users.

Deleting an Auth user cascades through that user's memberships, push tokens,
deliveries, drafts, responses, response edits, and score records. Templates,
groups, and other users' deliveries and response history are preserved. The
mobile implementation and local migration tests do not apply or deploy these
changes to the production Supabase project.