# Brainstorming: přihlášení, owner role a RLS

## Kontext a záměr

Projekt je mobilní aplikace pro ankety, úkoly a zpětnou vazbu. Jeden zakladatel
je jediným ownerem; ostatní uživatelé dostávají určené formuláře, odpovídají na
ně a získávají body. Klient je Expo SDK 54 / React Native. Cílem je, aby se
běžný uživatel po zavření a opětovném otevření aplikace nemusel znovu
přihlašovat, a aby přihlášení přezdívkou i ownerova oprávnění neotevíraly cestu
k převzetí účtu nebo dat.

Toto je návrh bezpečnostních hranic pro další plánování, nikoli audit produkční
Supabase instance. Podkladem je `docs/project.md`. Supabase klient, migrace,
Edge Functions ani RLS politiky původně v aplikaci nebyly.

## Co už podklad říká a co je potřeba doplnit

Podklad `project.md` popisuje jednoho ownera, uživatelské účty s e-mailem,
unikátní přezdívkou a heslem, přihlášení e-mailem nebo přezdívkou s heslem
a Edge Function `login-with-identifier`. Uvádí také ověření e-mailu, obnovu
hesla, anti-spam limity a zákaz zpřístupnění cizích e-mailů.

Chybí však přesné hranice oprávnění v databázi, způsob obnovy mobilní session,
životní cyklus owner role, pravidla pro ochranu bodů a odpovědí, konkrétní
chování přihlašovací funkce při chybách a bezpečnostní akceptační testy. Samotné
„jen owner může“ v aplikačním popisu nestačí: oprávnění musí vynucovat databáze
i serverové funkce, ne skrytá tlačítka nebo podmínky v klientovi.

## Cílová jednoduchost přihlášení

### Rozsah V1 převzatý z podkladu

- Uživatel: registrace, ověření e-mailu, přihlášení/odhlášení, obnova hesla,
  zobrazení vlastních aktivních formulářů, uložení konceptu, odeslání odpovědi,
  body a otevření doručení z push deep linku.
- Owner: dashboard, správa uživatelů a skupin, šablon, rozesílek, výsledků
  a bodů; okamžitý přehled odpovědí.
- Role V1: jediný owner a běžný uživatel. Další admin/manager role ani sdílené
  administrační účty nejsou v podkladu definovány a do tohoto návrhu nepatří.
- Základní relační entity jsou uživatel/profil, skupina a členství, šablona
  a její bloky, doručení formuláře, odpověď, body, push token a soukromý
  obrázkový objekt. Každá odpověď patří jednomu doručení; každé doručení je
  přiřazeno konkrétnímu uživateli a šabloně; členství propojuje uživatele se
  skupinami. Jde o konceptuální vztahy, ne předepsané názvy tabulek.

### Rozhodnutí návrhu

- Přezdívka je přihlašovací **identifikátor**, nikoli tajemství. Nové přihlášení
  přezdívkou proto stále vyžaduje heslo. Přezdívka sama nesmí otevřít účet.
- Při prvním přihlášení klient bezpečně uloží obnovovací session. Po běžném
  ukončení aplikace se session obnoví bez opakovaného zadávání přezdívky,
  e-mailu nebo hesla.
- Heslo ani přihlašovací tokeny se neukládají do běžného nešifrovaného úložiště,
  logů, analytiky ani push payloadu. Mobilní session patří do úložiště
  odpovídajícího citlivosti přihlašovacích údajů a dostupného na iOS i Androidu.
- Opětovné spuštění po odinstalaci, vymazání dat aplikace nebo zneplatnění
  session se považuje za nové přihlášení; uživatel použije e-mail/přezdívku
  a heslo, případně obnovu hesla přes ověřený e-mail.
- Obnova session neznamená obnovení důvěry po odhlášení nebo odvolání tokenu.
  Po explicitním odhlášení se lokální session odstraní a chráněné obrazovky
  zůstanou nedostupné.

### Toky a chybové stavy

1. Při startu aplikace je nejprve stav „ověřuji přihlášení“. Chráněný obsah se
   nezobrazí, dokud Auth session není ověřena nebo obnovena.
2. Platná session vede přímo na domovskou obrazovku. Chybějící, odvolaná nebo
   expirovaná session vede na přihlášení.
3. Přihlášení přijme e-mail nebo přezdívku a heslo. Funkce přeloží přezdívku
   interně na účet a ověří heslo přes Supabase Auth; klient nikdy nezíská
   seznam ani adresu cizích e-mailů.
4. Neexistující účet, nesprávné heslo a neověřený účet nesmí prozradit, zda
   přezdívka/e-mail existuje. Uživateli se zobrazí obecná, bezpečná chyba;
   validační a síťové chyby mají srozumitelné samostatné sdělení bez citlivých
   údajů.
5. Při výpadku sítě se neukáže úspěšné přihlášení. Session zůstává v původním
   stavu a uživatel může operaci bezpečně zopakovat.
6. Deep link z push notifikace otevře určené doručení až po obnovení session.
   Oprávnění k doručení znovu ověří backend; samotná znalost ID není přístup.

## Přezdívka a `login-with-identifier`

### Datová pravidla

- Přezdívka má normalizovanou hodnotu pro přihlášení a unikátní databázové
  omezení bez rozlišení velikosti písmen. Normalizace probíhá stejně při
  registraci, změně i přihlášení; databáze, ne kontrola v klientovi, rozhoduje
  o unikátnosti i při souběžných registracích.
- Veřejný profil může obsahovat zobrazovanou přezdívku. E-mail patří do
  privátní části dat a není dostupný ostatním uživatelům přes Data API.
- Přezdívky se považují za veřejně dohledatelné identifikátory, ne za
  autentizační údaj. Chybové zprávy i odpovědi API nesmí umožnit snadné
  zjišťování, kdo má účet.

### Požadavky na Edge Function

- `login-with-identifier` je dostupná před přihlášením; ověření JWT pro tuto
  funkci proto nelze zaměnit za ověření identity. Vstupní validace, omezení
  velikosti požadavku, limity pokusů a ochrana proti automatizovanému hádání
  jsou povinné.
- Funkce používá privilegovaný přístup pouze pro minimální serverovou lookup
  operaci. Klíč `service_role` se nikdy nedostane do aplikace. Přihlášení
  heslem ověřuje Supabase Auth, ne vlastní porovnávání hesel ani databázový
  dotaz funkce.
- Owner zadá secret pouze do pole hesla a nechá identifikátor prázdný.
  Admin větev se spustí jen při prázdném identifikátoru a přesné shodě hesla
  s `ADMIN_LOGIN_SECRET`; porovnání přes `OR` není povolené. Neprázdný
  identifikátor vždy znamená běžné přihlášení, i kdyby heslo shodou okolností
  bylo stejné jako secret.
- `ADMIN_LOGIN_SECRET` je serverový Supabase Secret, nikoli klientská
  konfigurace ani commitnutý `.env`. Je to bearer credential; musí být
  dlouhý/náhodný (implementace vyžaduje alespoň 32 bajtů), pokusy o něj
  podléhají sdílenému serverovému rate limitu a log smí obsahovat pouze obecné
  `admin login attempt`.
- Implementační limit je 30 pokusů na zdrojovou IP za 10 minut. Databáze
  ukládá pouze SHA-256 hash klíče limiteru; pokud Edge Function IP nezjistí,
  přihlášení se odmítne místo spuštění neomezeného nebo globálně sdíleného
  limitu, který by umožnil snadné zablokování ownera.
- Owner marker musí být v Auth `app_metadata` spravovaném serverem. Hodnota v
  `user_metadata` je uživatelsky měnitelná a nikdy nesmí stačit k bootstrapu
  role ani k vynechání běžných validačních pravidel registrace.
- Supabase Auth vyžaduje e-mailovou/telefonní identitu i pro interní účet.
  Proto server odvodí stabilní interní e-mail ve tvaru
  `admin-<SHA-256(secret)>@dotaznicek.invalid`; uživatel ho nezadává ani
  nedostává. Při prvním správném secretu server vytvoří/najde Auth účet,
  uloží jeho Auth UUID jako jediného ownera a vydá běžnou Auth session.
  Změna secretu změní heslo téhož owner účtu, protože owner UUID zůstává
  uložené v privátní databázové tabulce.
- Lookup přezdívky je přesný po normalizaci a vrací pouze interně potřebný
  identifikátor/e-mail účtu. Funkce nesmí tento lookup výsledek vrátit klientovi.
- Chyba pro neznámý identifikátor a chyba pro neplatné heslo mají stejný
  veřejný tvar. Odpovědi, logy i případné metriky neobsahují heslo, tokeny ani
  e-mail v prostém textu. Odpovědi nesmí zjevně odhalovat existenci účtu.
- Rate limit musí být sdílený a atomický na serveru; samotný limit uložený
  v paměti jednotlivého běhu funkce není dostatečný. Návrh limitu (klíčování,
  okno, odblokování) je implementační volba, ale testy musí ověřit omezení
  opakovaných pokusů i souběžných požadavků bez trvalého zablokování legitimního
  uživatele.
- Klient dostane session jen po úspěšném ověření hesla a následně ji uloží do
  bezpečného úložiště. Tokeny nesmí být vloženy do URL ani posílány v push
  notifikaci.

## Owner role

### Doporučený model

- Existuje právě jeden owner. Jeho účet se bootstrapuje pouze po úspěšné
  serverové kontrole secretu a pak se role váže na konkrétní Auth UUID.
  E-mail, přezdívka, první otevření aplikace ani pořadí registrace samy
  owner roli nezakládají.
- Veřejná registrace nikdy nezíská owner roli. Uživatel nemůže změnit vlastní
  roli ani vytvořit druhého ownera přes klienta, Auth user metadata, RPC,
  Edge Function pro běžné uživatele nebo přímé volání Data API.
- Klient může owner UI zobrazit podle role, ale toto je pouze UX. Každá owner
  operace ověřuje oprávnění z důvěryhodného serverového/databázového zdroje.
- Přidělení owner role je dostupné výhradně service-role operaci volané z
  chráněné Edge Function po ověření secretu. Není zde samoobslužné předání
  owner role ani automatické povýšení běžného účtu.
- Obnova přístupu probíhá výměnou secretu v Supabase Secrets; při příštím
  secret loginu server aktualizuje heslo již navázaného Auth UUID. Interní
  `.invalid` e-mail nemá e-mailovou obnovu hesla.
- Vlastní profil uživatele může měnit jen povolená profilová pole. Změna
  `role`, `user_id`, e-mailu Auth účtu nebo bezpečnostních metadat nesmí projít
  přes obecný update profilu.

### Owner oprávnění

Owner smí spravovat uživatele a skupiny, šablony, rozesílky, výsledky a body
v rozsahu V1. Běžný uživatel smí vidět jen vlastní profilová data, svá aktivní
doručení, obsah šablon potřebný k těmto doručením a vlastní odpovědi/bodový
souhrn. Uživatelská role sama o sobě nedává přístup k tabulkám cizích uživatelů.

### Provisioning a obnova ownera — návrhové rozhodnutí

- Owner se provisionuje samostatným bezpečným nasazovacím krokem po vytvoření
  Auth účtu. Důvěryhodný provozovatel přiřadí pevné Auth user ID v migraci nebo
  ekvivalentním uzamčeném provozním procesu; owner se nevybírá dynamicky podle
  e-mailu, přezdívky či pořadí registrace.
- Pokud je účet ztracený nebo kompromitovaný, přístup se obnoví přes ověřeného
  provozovatele Supabase projektu: nejprve obnovit/odvolat Auth účet, potom
  provést auditovanou změnu pevného owner ID bezpečnou migrací a ověřit, že
  předchozí účet ztratil owner oprávnění. Aplikace sama nenabízí „povýšit mě
  na ownera“ ani samoobslužné předání role.
- Jde o výchozí provozní volbu tohoto návrhu, protože podklad stanovuje
  zakladatele jako jediného ownera a mimořádnou změnu role nepopisuje.

## RLS a hranice databáze

RLS je zapnuté pro každou tabulku vystavenou klientovi. Zvlášť se kontrolují
SQL granty: RLS omezuje řádky, ale nenahrazuje oprávnění k tabulkám ani ochranu
sloupců. Privátní tabulky/Schémata, která klient nepotřebuje, se nevystavují
přes Data API. Service role obchází RLS, proto smí být použita pouze na
důvěryhodném serveru a jen s nejmenší nutnou sadou operací.

| Oblast dat | Běžný uživatel | Owner |
| --- | --- | --- |
| Profily | Číst bezpečné veřejné profily jen tam, kde je to potřeba; číst/upravit jen vlastní povolená pole. Žádný přístup k e-mailům a rolím ostatních. | Číst a spravovat profily podle funkcí V1; bezpečnostní role se mění pouze řízeným nasazením. |
| Skupiny a členství | Číst pouze vlastní relevantní členství, pokud ho UI potřebuje; neměnit přiřazení. | Spravovat skupiny a členství. |
| Šablony | Číst pouze obsah potřebný pro vlastní aktivní doručení. Neměnit publikovanou šablonu. | Vytvářet, měnit, archivovat a číst všechny šablony. |
| Doručení formulářů | Číst a měnit pouze vlastní doručení v povolených stavech. Nemůže přiřadit doručení sobě ani jinému uživateli. | Vytvářet rozesílky, číst a spravovat všechna doručení. |
| Odpovědi | Vytvořit a číst vlastní odpověď pouze k vlastnímu doručení; opravu přidat jako nový neměnný záznam historie, původní odpověď nepřepsat. Nečíst cizí odpovědi. | Číst původní odpověď, poslední opravu a její čas; spravovat výsledky podle V1. |
| Body | Číst vlastní souhrn. Nemůže si připsat, odečíst ani převést body. | Udělovat/upravovat body pouze přes kontrolovanou serverovou operaci s ověřením a auditní stopou. |
| Push tokeny | Registrovat/odstranit tokeny přiřazené pouze vlastnímu Auth ID. | Spravovat odesílání; neposílat push přímo z mobilního klienta přes tajné klíče. |
| Obrázky ve Storage | Číst obrázky zpřístupněné přes vlastní doručení; zapisovat jen tam, kde V1 výslovně dovoluje. | Spravovat obrázky šablon. |

### Pravidla pro politiky

- Každá tabulka má explicitně popsané politiky pro `SELECT`, `INSERT`,
  `UPDATE` a `DELETE`; nepoužívané operace nejsou povoleny „pro jistotu“.
- U `INSERT` se kontroluje vlastnictví přes `auth.uid()` v `WITH CHECK`.
  U `UPDATE` se kontroluje původní přístup i přípustnost nových hodnot, aby
  vlastník nemohl změnit `user_id`, `role`, stav rozesílky nebo příjemce.
- Politiky pro vlastníka a vlastníka dat mají bezpečné vazby na Auth user ID.
  Pomocná funkce pro kontrolu role, pokud se použije, má pevný `search_path`,
  minimální práva, jasně omezené EXECUTE granty a nemůže být zneužita jako
  obecný privilegovaný RPC.
- Neautorizovaný dotaz na existující cizí záznam se chová stejně bezpečně jako
  chybějící záznam; ID v klientu ani deep linku není důkaz oprávnění.
- Odpovědi a body se nemají měnit dvěma nezávislými klientskými zápisy. Odeslání
  odpovědi a připsání bodů proběhne v jedné transakční, idempotentní serverové
  operaci, která sama ověří vlastníka doručení, jeho stav, validitu odpovědi
  a pravidlo pro body. Klient nemůže měnit vypočtené body.
- Owner může ručně upravit body pouze přes append-only operaci s Auth UUID
  cílového uživatele a povinným důvodem; přímý insert/update do score ledgeru
  z klienta není povolen.
- Na jedno doručení vznikne nejvýše jedna původní odpověď; opakovaný požadavek
  po výpadku sítě je idempotentní a nepřipíše další body. Po prvním odeslání
  uživatel může zvolit „Opravit odpověď“; každé nové odeslání přidá další
  neměnnou verzi s časem a autorem. Původní odpověď zůstává dostupná ownerovi.
- Body se připisují atomicky pouze při prvním odeslání. Každá oprava vytvoří
  outbox událost pro admin push, ale nepřidá body. Payload události obsahuje
  jen ID odpovědi/doručení, nikoli obsah odpovědi nebo session token.
- Změny šablon a rozesílek, které by změnily přístup k datům po jejich
  publikování, musí zachovat konzistenci existujících doručení a odpovědí.
- Realtime kanály, Storage objekty, RPC funkce a Edge Functions se považují
  za součást stejného bezpečnostního modelu; nestačí zabezpečit jen tabulky.

## Nejdůležitější hrozby a prevence

1. **Povýšení běžného účtu na ownera:** role není z klientem upravitelných
   metadat/profilových sloupců; policy i serverové operace odmítnou změnu.
2. **Převzetí účtu podle známé přezdívky:** vždy je nutné heslo; přezdívka
   samotná neobnoví session a chyba neprozradí existenci účtu.
3. **Enumerace přezdívek nebo e-mailů:** obecné chybové odpovědi, žádný
   veřejný lookup endpoint, omezení pokusů, privátní e-mail a bezpečné logy.
4. **Čtení cizí odpovědi změnou UUID:** RLS podmínka odvozená z Auth identity
   a doručení, testovaná pro vlastní i cizí ID.
5. **Falšování bodů či příjemce:** zápis přes serverovou transakci a
   kontrolované sloupce; klientské update body/recipient/status odmítnout.
6. **Přepis historie odpovědí:** původní odpověď i opravy jsou append-only;
   body se udělí jednou a oprava odešle pouze admin outbox událost.
7. **Zneužití service role:** tajemství pouze v serverovém prostředí; každá
   funkce s privilegovaným klíčem má úzký účel, validaci vstupů a ověřuje
   oprávnění nebo příslušnou Auth operaci.
8. **Únik přístupu přes notifikaci:** push payload obsahuje jen minimum pro
   navigaci, nikoli session, e-mail nebo odpověď; cílová data načíst až po
   ověření session a RLS.

## Akceptační testy pro další implementaci

- Registrace dvou přezdívek, které se liší pouze velikostí písmen nebo
  normalizovanými mezerami, nemůže vytvořit nejednoznačné účty; souběžná
  registrace skončí právě jedním úspěchem.
- Správná přezdívka a špatné heslo neumožní přihlášení. Neznámá přezdívka
  vrátí nerozlišitelnou veřejnou chybu. Endpoint po limitu pokusů odmítne
  další pokusy dle zvolené politiky.
- Po úspěšném přihlášení, ukončení procesu a novém spuštění se session obnoví
  a uživatel se dostane na domovskou obrazovku bez zadání údajů.
- Po odhlášení, odstranění session nebo jejím odvolání klient neukáže chráněný
  obsah; chybový stav při obnově session není prezentován jako úspěch.
- Běžný účet nemůže upravit svou roli, vložit dalšího ownera, číst privátní
  e-mail, vyjmenovat uživatele, přiřadit si cizí doručení ani číst cizí
  odpověď.
- Owner účet má přístup k určeným administračním operacím; běžný uživatel ne,
  a to i při ručním volání Data API/RPC mimo aplikaci.
- Uživatel nemůže smazáním či změnou `user_id` doručení získat cizí odpověď.
  Neplatné, duplicitní nebo cizí odeslání odpovědi nepřipíše body.
- Oprava přidá verzi a čas, nepřepíše původní odpověď a nepřipíše další body;
  opakované opravy zachovají všechny předchozí verze.
- Neautorizovaný přístup do Storage, Realtime, RPC a Edge Function je ověřen
  stejně jako přístup k REST tabulkám.
- Push deep link před přihlášením nejprve obnoví/vyžádá session a po ní ověří,
  že přihlášený účet smí konkrétní doručení otevřít.

## Rozsah a ne-cíle

- Zahrnuto: V1 autentizace, přetrvání session po restartu aplikace, přihlášení
  běžných uživatelů e-mailem/přezdívkou přes Edge Function, admin secret login,
  jediné owner Auth UUID a RLS hranice pro hlavní data, Storage/RPC/Realtime;
  odpovědi podporují neměnné opravy a první odeslání uděluje body právě jednou.
- Nezahrnuto: volba konkrétní služby externího CAPTCHA, přesné numerické
  hodnoty limitů, samoobslužné převádění owner role, více rolí administrátorů,
  anonymní odpovědi a sdílené účty.
- Veřejná registrace versus registrace pouze přes pozvánku je v podkladu
  ponechána jako produktová volba. Pro tento bezpečnostní návrh platí, že
  žádný způsob registrace nezíská owner oprávnění; konkrétní omezení registrace
  lze rozhodnout odděleně bez oslabení RLS.

## Implementační volby ponechané vývojáři

- Konkrétní tabulky, názvy sloupců, indexy a migrace, pokud zachovají uvedený
  model přístupu a unikátnost normalizované přezdívky.
- Přesná struktura rate limitu, prahy, doby zadržení a mitigace automatizace,
  podložené testy a pozorovatelností bez ukládání citlivých údajů.
- Konkrétní bezpečné úložiště mobilní session a integrační rozhraní se
  Supabase Auth kompatibilní s Expo SDK 54 a iOS/Android.
- Přesné rozdělení kontrol mezi RLS, transakční SQL funkci a Edge Functions;
  nesmí dojít k obejití RLS z klienta ani k nekontrolovanému použití service
  role.
- Názvy stavů doručení/odpovědi a chování při opakovaném odeslání, pokud jsou
  operace bezpečné při retry a body se nepřipíšou více než jednou.

## Otevřený produktový bod

Podklad připouští veřejnou registraci nebo pozvánky/QR. Doporučený výchozí
postup je ponechat tuto volbu mimo autentizační/RLS návrh: první implementace
může navázat na zvolený onboarding, ale v obou variantách musí vyžadovat
ověření e-mailu, mít ochranu proti spamu a oddělit vytvoření účtu od přidělení
owner role. Pokud má aplikace od prvního vydání být dostupná veřejnosti, je
rozumnější vyžadovat pozvánku nebo QR pro samotné členství v komunitě, nikoli
pro vznik účtu potřebného k obnově session.

## Shrnutí doporučeného řešení

Z pohledu uživatele je tok jednoduchý: jednou se zaregistruje e-mailem,
přezdívkou a heslem; následně může pro nové přihlášení použít e-mail nebo
přezdívku s heslem. Aplikace bezpečně obnoví session po běžném restartu.
Přezdívka pomáhá s přihlášením, ale nikdy nenahrazuje heslo. V pozadí server
skrývá mapování přezdívky na e-mail, sjednocuje veřejné chyby a omezuje pokusy.

Ownera určuje řízené nasazení podle Auth ID. RLS a serverové transakční
operace pak vynucují přístup na úrovni řádků i citlivých změn: uživatel vidí
svá data, owner spravuje administrační data, body se udělují pouze
kontrolovaným způsobem a žádný klientský stav není autoritou.

## Rozhodnutí doplněná po kontrole návrhu

- **V1 a role:** zdrojový podklad už popisuje hlavní toky uživatele i ownera;
  v návrhu jsou shrnuté výše. Nezavádí se třetí role ani nové produktové
  obrazovky.
- **Odpovědi a body:** aktualizovaný požadavek dovoluje opravu po odeslání.
  Řešení uchovává původní odpověď i každou opravu jako verzi, zobrazuje
  původní a poslední verzi s časem a připisuje body jen za první odeslání.
- **Owner login:** aktualizovaný požadavek nahrazuje původní jednorázovou
  migraci přihlášením prázdným identifikátorem a serverovým secretem. Interní
  Auth e-mail je `.invalid` a odvozený ze secretu; role se stále kontroluje
  proti Auth UUID a RLS.
- **Datový model:** z podkladu jsou odvozeny konceptuální entity a vazby.
  Schéma zůstává implementační volbou; před vytvořením politik se musí ověřit,
  že konkrétní cizí klíče a stavy zachovávají popsané vlastnictví.
