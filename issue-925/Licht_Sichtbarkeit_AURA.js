// AURA-Hilfsfunktion: welche Lampen auf der AURA-Licht-Seite angezeigt werden.
// Sucht alle Lampen (alias.0, Rolle switch.light, Gerät oder Datenpunkt in der Funktion "Licht" = enum.functions.funcLight)
// und legt je Lampe einen Schalter an:
//   0_userdata.0.VIS.AURA_Hilfsfunktionen.Licht_anzeigen.<Alias-Gerät>   (true = in der Liste zeigen)
// Name des Schalters = "Raum · Lampe". Neue Lampen bekommen true (sichtbar), bestehende Haken bleiben.
// Zusätzlich je Lampe den Typ für das gemeinsame AURA-Popup "Licht":
//   0_userdata.0.VIS.AURA_Hilfsfunktionen.Licht_Typ.<Alias-Gerät> =
//   farbe_rgb[_ct] (hat .RGB, Rolle level.color.rgb) | farbe_hue[_ct] (hat .HUE + .SAT) – "_ct" wenn zusätzlich .TEMPERATURE
//   farbtemperatur_2000_6500 / farbtemperatur_2200_4000 (hat .TEMPERATURE, Bereich aus min/max) | dimmer (.SET mit Rolle level.dimmer) | schalter
//   Das Popup zeigt per Bedingung nur die passende Bedienung -> neue Lampen brauchen keine Änderung in AURA.
// Schalter von Lampen, deren Alias es nicht mehr gibt, werden entfernt. Läuft beim Start, bei jeder Objekt-
// änderung unter alias.0 / an Funktion „Licht“ / an Räumen und zusätzlich alle 10 Minuten.
const ZIEL = '0_userdata.0.VIS.AURA_Hilfsfunktionen.Licht_anzeigen.';
const FUNKTION = 'enum.functions.funcLight';
const TYP = '0_userdata.0.VIS.AURA_Hilfsfunktionen.Licht_Typ.';
// Lampentyp aus den Datenpunkten des Alias-Geräts (ioBroker-Standardnamen, siehe type-detector)
function lampenTyp(geraet) {
    const rolle = id => { const o = getObject(geraet + '.' + id); return o ? String(o.common.role || '') : ''; };
    const ct = rolle('TEMPERATURE').startsWith('level.color.temperature') ? '_ct' : '';
    if (rolle('RGB').startsWith('level.color.rgb')) return 'farbe_rgb' + ct;
    if (rolle('HUE').startsWith('level.color.hue') && rolle('SAT').startsWith('level.color.saturation')) return 'farbe_hue' + ct;
    const t = getObject(geraet + '.TEMPERATURE');
    if (t && ct) {
        // AURA-Popup gibt es für zwei Farbtemperatur-Bereiche; Lampen bis 4000 K kalt bekommen den schmalen
        return Number(t.common.max) > 0 && Number(t.common.max) <= 4500 ? 'farbtemperatur_2200_4000' : 'farbtemperatur_2000_6500';
    }
    const d = getObject(geraet + '.SET');
    if (d && d.common.role === 'level.dimmer' && existsObject(geraet + '.ON_SET')) return 'dimmer';
    return 'schalter';
}
// Aliase, deren Ziel unter diesem Ordner liegt, haben gerade kein Gerät (z. B. Birne umgezogen) -> automatisch ausblenden.
// Wird der Alias wieder auf ein echtes Gerät umgehängt, wird die Lampe automatisch wieder eingeblendet.
const PLATZHALTER = '0_userdata.0.Platzhalter.';
function ziel(id) {
    const a = getObject(id)?.common?.alias?.id;
    return typeof a === 'object' && a ? a.read || a.write || '' : a || '';
}

function name(o) {
    const n = o && o.common && o.common.name;
    return typeof n === 'object' && n ? n.de || n.en || '' : n || '';
}
async function abgleich() {
    const lichtMitglieder = (getObject(FUNKTION)?.common?.members) || [];
    const raeume = getEnums('rooms');
    const raumVon = id => {
        const r = raeume.find(e => e.members.some(m => id === m || id.startsWith(m + '.')));
        return r ? (typeof r.name === 'object' ? r.name.de || r.name.en : r.name) : '';
    };
    const gefunden = new Set();
    for (const id of $('state[id=alias.0.*][role=switch.light]')) {
        const geraet = id.slice(0, id.lastIndexOf('.'));
        if (!lichtMitglieder.some(m => id === m || geraet === m || id.startsWith(m + '.'))) continue;
        gefunden.add(geraet);
        beobachte(geraet);
        beobachte(id);
        const text = [raumVon(id), name(getObject(geraet)) || geraet.split('.').pop()].filter(Boolean).join(' · ');
        const ohneGeraet = ziel(id).startsWith(PLATZHALTER);
        const typ = lampenTyp(geraet), tz = TYP + geraet;
        if (!existsState(tz)) {
            await createStateAsync(tz, typ, { name: 'Lampentyp für AURA-Popup: ' + text, type: 'string', role: 'text', read: true, write: false });
        } else if (getState(tz).val !== typ) {
            await setStateAsync(tz, typ, true);
            log('Licht_Typ: ' + text + ' -> ' + typ);
        }
        if (existsObject(geraet + '.TEMPERATURE')) beobachte(geraet + '.TEMPERATURE');
        const hz = ZIEL + geraet;
        const anzeige = text + (ohneGeraet ? ' (kein Gerät)' : '');
        if (!existsState(hz)) {
            await createStateAsync(hz, !ohneGeraet, { name: anzeige, type: 'boolean', role: 'switch', read: true, write: true, def: true });
            await extendObjectAsync(hz, { native: { platzhalter: ohneGeraet } });
            log('Licht_anzeigen: neue Lampe ' + anzeige);
        } else {
            const o = getObject(hz);
            if (name(o) !== anzeige) await extendObjectAsync(hz, { common: { name: anzeige } });
            const war = !!(o.native && o.native.platzhalter);
            if (ohneGeraet && !war) { await setStateAsync(hz, false, true); log('Licht_anzeigen: ' + text + ' hat kein Gerät mehr -> ausgeblendet'); }
            if (!ohneGeraet && war) { await setStateAsync(hz, true, true); log('Licht_anzeigen: ' + text + ' hat wieder ein Gerät -> eingeblendet'); }
            if (ohneGeraet !== war) await extendObjectAsync(hz, { native: { platzhalter: ohneGeraet } });
        }
    }
    for (const basis of [ZIEL, TYP]) {
        for (const id of $('state[id=' + basis + '*]')) {
            if (!gefunden.has(id.slice(basis.length))) {
                await deleteStateAsync(id);
                log('Licht-Hilfsdatenpunkt entfernt (Alias gibt es nicht mehr) ' + id);
            }
        }
    }
}
// sofort reagieren, wenn sich etwas an den Lampen ändert: neue/gelöschte/umbenannte Alias-Objekte,
// Änderungen an der Funktion "Licht" oder an den Räumen (gebündelt, 5 s nach der letzten Änderung)
let timer = null;
function bald() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; abgleich(); }, 5000);
}
// onObject kann in dieser JavaScript-Version nur exakte IDs (kein *) – deshalb:
// - Funktion "Licht": eine neue Lampe muss dort eingetragen werden -> löst sofort aus
// - jeden Raum und jede bekannte Lampe (Gerät + Schalt-Datenpunkt) einzeln: Umbenennen/Löschen -> sofort
const beobachtet = new Set();
function beobachte(id) {
    if (beobachtet.has(id)) return;
    beobachtet.add(id);
    onObject(id, bald);
}
beobachte('enum.functions.funcLight');
getEnums('rooms').forEach(r => beobachte(r.id));

abgleich();
schedule('*/10 * * * *', abgleich); // Sicherheitsnetz
