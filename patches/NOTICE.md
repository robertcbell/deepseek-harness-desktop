# Maestro patch provenance

`maestro-v4-0.9.0.patch` changes the distributed JavaScript of `@ddtcorex/dsh-maestro-supervisor` 0.9.0 ([upstream](https://github.com/ddtcorex/dsh-maestro-supervisor)). Upstream is MIT licensed; its license is retained in `MAESTRO-LICENSE`. No complete upstream package or local runtime state is vendored. The patch is version-specific and explicitly applied by the caller.

Frame boundaries follow [RFC 8878](https://www.rfc-editor.org/rfc/rfc8878.html#section-3.1.1): the closeout patch strengthens the locally tested decoder by walking frame/block lengths and joining buffers before UTF-8 decoding. Those two refinements have synthetic regression coverage; they were not installed into the running DSH profile or subjected to another live kill during closeout.
