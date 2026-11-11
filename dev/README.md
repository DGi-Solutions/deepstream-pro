# Entwicklung von DeepStream Pro

DeepStream Pro wird ausschließlich für macOS angeboten. Der geprüfte Entwicklungsweg ist der [Apple-Silicon-Build](macos/README-deepstream.md).

Nach dem Klonen das gebundene Submodul bereitstellen:

```sh
git submodule update --init external/mpvqt
```

[Projektstatus](../docs/STATUS.md), [Audio-Architektur](../docs/AUDIO-ARCHITECTURE.md) und [Übergabe](../DEEPSTREAM-HANDOFF.md) beschreiben den aktuellen Stand und die Prüfungen.

Die vorhandenen Windows-/Linux-Verzeichnisse stammen aus dem Upstream. Sie sind keine angebotenen oder geprüften DeepStream-Pro-Builds.
