#pragma once
#include <QObject>
#include <QUrl>
#include <QVariantMap>
#include "LocalMediaGate.h"

// Created only by the native QML tree, not registered as a WebChannel object.
class LocalMediaController : public QObject {
  Q_OBJECT
public:
  explicit LocalMediaController(QObject *parent = nullptr);
  Q_INVOKABLE bool open(const QUrl &url);
  Q_INVOKABLE bool close();
  Q_INVOKABLE QVariantMap state();
  Q_INVOKABLE void play();
  Q_INVOKABLE void pause();
  Q_INVOKABLE void seek(qint64 milliseconds);
  Q_INVOKABLE void volume(int value);
  Q_INVOKABLE bool selectTrack(const QString &type, int id);
  Q_INVOKABLE QString subtitleDialogToken();
  Q_INVOKABLE bool addSubtitleFile(const QUrl &url, const QString &token);
  Q_INVOKABLE bool canDropFile(const QUrl &url) const;
  Q_INVOKABLE QString dropInteractionToken() const;
Q_SIGNALS:
  void invalidated();
  void startupFailed(bool cancelled);
private:
  bool ready();
  bool sameFile() const;
  bool cancelOwnedPending();
  bool advanceOwnedEntryWithoutClearingQueue();
  void externalChange();
  LocalMediaGate m_gate;
  QString m_file;
  bool m_ownRequest = false;
  bool m_started = false;
  bool m_foreignQueue = false;
  quint64 m_loadRevision = 0;
};
