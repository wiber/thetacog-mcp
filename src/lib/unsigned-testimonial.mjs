// src/lib/unsigned-testimonial.mjs — C372's unsigned-testimonial wording, declared ONCE.
// MOVED HERE from scripts/vna/public-surface-register.mjs (C369, 2026-09-28), which re-exports these four
// byte-identical, following the C154 precedent (notary-seat-checkout.mjs, marketplace.mjs): a Next.js page
// cannot import scripts/, so anything a page needs lives in src/lib with no node: imports. C367 (the book-club
// email) and C369 (the iamfim.com testimonial, after the two doors) both read off this one register, so the
// two surfaces can never drift apart wording-for-wording.
//
// CHAIR CONSTRAINT (C372, binding on every surface built from it): NO CUSTOMER HAS SIGNED THIS. It ships only
// as an unsigned sentence — an empty signature line, never a fabricated name, because a fabricated testimonial
// is the one claim that sinks a receipts company — with a question landing directly on the reader.
export const UNSIGNED_TESTIMONIAL_KICKER = 'An unsigned testimonial';
export const UNSIGNED_TESTIMONIAL_QUOTE = 'I am the one holding the bag when our AI breaks a client contract. Every change our agents make now carries a receipt the machine did not write, one my carrier can recompute.';
export const UNSIGNED_TESTIMONIAL_SIGNATURE_LINE = '— ______________________________';
export const UNSIGNED_TESTIMONIAL_QUESTION = 'Would you put your name on this? Would your boss? Would anyone you know?';
