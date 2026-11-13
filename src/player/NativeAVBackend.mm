#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#ifdef DEEPSTREAM_HLS_CONTROLLED_MPV_TEST
#import <AVKit/AVKit.h>
#endif
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
#import <AudioToolbox/AudioToolbox.h>
#endif
#include "NativeAVBackend.h"
#include "DolbyVisionTrackEvidence.h"
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
#include "HlsSessionRelay.h"
#ifdef DEEPSTREAM_EXPERIMENTAL_DOLBY_VISION_AUDIO_V2
#include "NativeHlsAudioCodecPolicy.h"
#endif
#endif
#include <QPointer>
#include <QQuickWindow>
#include <QTimer>
#include <cmath>
#include <limits>
#include <utility>

// Candidate only: video is a sibling below the Qt render layer.
// Require an existing common parent; never create or reconfigure Qt layers.
static bool positionVideoBelowQt(QQuickWindow *window, AVPlayerLayer *video) {
 if (!window || !video || ![NSThread isMainThread]) return false;
 NSView *view=(__bridge NSView *)(void *)window->winId();
 CALayer *qtLayer=view.layer;
 CALayer *parent=qtLayer.superlayer;
 if (!view || !qtLayer || !parent || parent == video) return false;
 [CATransaction begin];
 [CATransaction setDisableActions:YES];
 NSArray<CALayer *> *siblings=parent.sublayers;
 NSUInteger v=[siblings indexOfObjectIdenticalTo:video];
 NSUInteger q=[siblings indexOfObjectIdenticalTo:qtLayer];
 if (video.superlayer != parent || v == NSNotFound || q == NSNotFound || v >= q) {
  [video removeFromSuperlayer];
  [parent insertSublayer:video below:qtLayer];
 }
 video.frame=[parent convertRect:qtLayer.bounds fromLayer:qtLayer];
 [CATransaction commit];
 return video.superlayer == parent;
}

static qint64 milliseconds(CMTime t) {
 const double sec=CMTimeGetSeconds(t);
 if(!std::isfinite(sec)||sec<0||sec>double(std::numeric_limits<qint64>::max())/1000.0) return -1;
 return qint64(sec*1000.0);
}
struct NativeAVBackend::Impl {
 AVPlayer *__strong player=nil;
 AVPlayerItem *__strong item=nil;
 AVPlayerLayer *__strong layer=nil;
#ifdef DEEPSTREAM_HLS_CONTROLLED_MPV_TEST
 NSWindow *__strong nativeWindow=nil;
 AVPlayerView *__strong nativeView=nil;
 id __strong closeObserver=nil;
#endif
 id __strong endedObserver=nil;
 id __strong failedObserver=nil;
 QPointer<QQuickWindow> window;
 QTimer timer;
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
 std::unique_ptr<HlsSessionRelay> relay;
 QString monitoredAudioCodec;
 int monitoredAudioChannels=0;
 NSUInteger accessLogBeforeRoot=0;
 bool rootObserved=false;
 NSDate *__strong rootRequestTime=nil;
#endif
 Acquire acquire; Release release;
 quint64 id=0, generation=0;
 bool leased=false, readyEmitted=false, videoReadyEmitted=false, failed=false;
 qint64 lastDuration=-1;
 int lastVolume=-1; bool lastMuted=false;
 int requestedRate=1000;
 QString lastState;
 QVariantMap failureState;
};
NativeAVBackend::NativeAVBackend(QObject *parent):QObject(parent),d(std::make_unique<Impl>()) {
 d->timer.setInterval(100); connect(&d->timer,&QTimer::timeout,this,&NativeAVBackend::poll);
}
NativeAVBackend::~NativeAVBackend(){reset();}
void NativeAVBackend::setOutputLease(Acquire a,Release r){if(d->leased)return;d->acquire=std::move(a);d->release=std::move(r);}
void NativeAVBackend::setVideoWindow(QQuickWindow *w){if(d->id)return;d->window=w;}
quint64 NativeAVBackend::session()const{return d->id;}
QString NativeAVBackend::audioSelectionState(quint64 id)const{
 if(!id||id!=d->id||!d->item||d->item.status!=AVPlayerItemStatusReadyToPlay)return QStringLiteral("item_not_ready");
 AVMediaSelectionGroup *group=[d->item.asset mediaSelectionGroupForMediaCharacteristic:AVMediaCharacteristicAudible];
 if(!group)return QStringLiteral("group_unavailable");
 if(group.options.count!=1)return QStringLiteral("option_count_not_one");
 AVMediaSelectionOption *selected=[d->item.currentMediaSelection selectedMediaOptionInMediaSelectionGroup:group];
 if(!selected)return QStringLiteral("selection_pending");
 return [selected isEqual:group.options.firstObject] ? QStringLiteral("single_selected") : QStringLiteral("selection_mismatch");
}
bool NativeAVBackend::hasOneSelectedAudioOption(quint64 id)const{
 return audioSelectionState(id)==QStringLiteral("single_selected");
}
QVariantMap NativeAVBackend::audioSelectionEvidence(quint64 id)const{
 if(!id||id!=d->id||!d->item||d->item.status!=AVPlayerItemStatusReadyToPlay)return {};
 AVMediaSelectionGroup *group=[d->item.asset mediaSelectionGroupForMediaCharacteristic:AVMediaCharacteristicAudible];
 if(!group)return {};
 AVMediaSelectionOption *selected=[d->item.currentMediaSelection selectedMediaOptionInMediaSelectionGroup:group];
 return {{QStringLiteral("availableAudioOptions"), static_cast<int>(group.options.count)},
         {QStringLiteral("selectedAudioOptions"), selected ? 1 : 0}};
}
QVariantMap NativeAVBackend::videoSelectionEvidence(quint64 sessionId)const{
 QVariantMap result{{QStringLiteral("status"),QStringLiteral("unknown")},
                    {QStringLiteral("outputConfirmed"),false}};
 if(!sessionId||sessionId!=d->id||!d->item||d->item.status!=AVPlayerItemStatusReadyToPlay)return result;
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
 if(d->relay) {
  result.insert(QStringLiteral("hlsOffered"),d->relay->offeredDolbyVisionEvidence());
  NSArray<AVPlayerItemAccessLogEvent *> *events=d->item.accessLog.events;
  AVPlayerItemAccessLogEvent *last=d->rootObserved && events.count>d->accessLogBeforeRoot ? events.lastObject : nil;
  // A delayed entry predating this root request is not evidence about the
  // currently accepted master playlist.
  if(!last.playbackStartDate || !d->rootRequestTime ||
     [last.playbackStartDate compare:d->rootRequestTime]==NSOrderedAscending)last=nil;
  NSString *uri=last.URI;
  if(uri && uri.length<=8192){
   const char *utf8=uri.UTF8String;
   if(utf8)result.insert(QStringLiteral("hlsLastObserved"),d->relay->lastObservedDolbyVariant(QByteArray(utf8)));
  }
 }
#endif
 AVPlayerItemTrack *selected=nil;NSUInteger count=0;
 for(AVPlayerItemTrack *track in d->item.tracks){
  if(track.enabled && [track.assetTrack.mediaType isEqualToString:AVMediaTypeVideo]){selected=track;++count;}
 }
 if(count!=1 || !selected.assetTrack){result.insert(QStringLiteral("status"),QStringLiteral("track-ambiguous"));return result;}
 for(id description in selected.assetTrack.formatDescriptions){
  CMFormatDescriptionRef fmt=(__bridge CMFormatDescriptionRef)description;if(!fmt)continue;
  CFDictionaryRef raw=CMFormatDescriptionGetExtensions(fmt);if(!raw)continue;
  NSDictionary *extensions=(__bridge NSDictionary *)raw;
  NSDictionary *atoms=extensions[(__bridge NSString *)kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms];
  if(![atoms isKindOfClass:[NSDictionary class]])continue;
  id value=atoms[@"dvcC"] ?: atoms[@"dvvC"];
  if(![value isKindOfClass:[NSData class]])continue;
  NSData *data=(NSData *)value;
  if(data.length>1024){result.insert(QStringLiteral("status"),QStringLiteral("invalid-record"));return result;}
  const auto evidence=decodeDolbyVisionTrack(QByteArray(static_cast<const char *>(data.bytes),static_cast<int>(data.length)));
  if(!evidence.valid){result.insert(QStringLiteral("status"),QStringLiteral("invalid-record"));return result;}
  result.insert(QStringLiteral("status"), evidence.eligible ? QStringLiteral("dv-track-record") : QStringLiteral("unsupported-dv-track-record"));
  result.insert(QStringLiteral("profile"),evidence.profile);result.insert(QStringLiteral("level"),evidence.level);
  result.insert(QStringLiteral("compatibilityId"),evidence.compatibilityId);result.insert(QStringLiteral("mode"),evidence.mode);
  return result;
 }
 return result; // HLS may omit dvcC/dvvC; absence is not evidence of SDR.
}


#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
QString NativeAVBackend::authenticatedHlsAudioState(quint64 id,const QString& codec,int expectedChannels)const{
 bool recognized=codec==QStringLiteral("eac3") || codec==QStringLiteral("aac");
#ifdef DEEPSTREAM_EXPERIMENTAL_DOLBY_VISION_AUDIO_V2
 recognized=recognized || codec==QStringLiteral("ac3") || codec==QStringLiteral("flac") || codec==QStringLiteral("alac");
 if((codec==QStringLiteral("ac3") || codec==QStringLiteral("flac") || codec==QStringLiteral("alac")) && !expectedChannels)return QStringLiteral("unsupported_codec");
 if(expectedChannels && !NativeHlsAudioCodecPolicy::permitted(codec.toStdString(),expectedChannels))return QStringLiteral("unsupported_codec");
#else
 if(expectedChannels)return QStringLiteral("unsupported_codec");
#endif
 if(!recognized)return QStringLiteral("unsupported_codec");
 if(!id||id!=d->id||!d->item||d->item.status!=AVPlayerItemStatusReadyToPlay)return QStringLiteral("pending");
 AVMediaSelectionGroup *group=[d->item.asset mediaSelectionGroupForMediaCharacteristic:AVMediaCharacteristicAudible];
 if(group){
  if(group.options.count!=1)return QStringLiteral("ambiguous");
  AVMediaSelectionOption *selected=[d->item.currentMediaSelection selectedMediaOptionInMediaSelectionGroup:group];
  if(!selected)return QStringLiteral("pending");
  if(![selected isEqual:group.options.firstObject])return QStringLiteral("ambiguous");
 }
 int audioTracks=0;bool enabled=false;bool formatKnown=false;bool allExpected=true;
 for(AVPlayerItemTrack *itemTrack in d->item.tracks){
  AVAssetTrack *track=itemTrack.assetTrack;if(!track||![track.mediaType isEqualToString:AVMediaTypeAudio])continue;
  ++audioTracks;enabled=itemTrack.enabled;
  for(NSObject* value in track.formatDescriptions){
   CMFormatDescriptionRef fmt=(__bridge CMFormatDescriptionRef)value;if(!fmt)continue;
   formatKnown=true;
   const auto subtype=CMFormatDescriptionGetMediaSubType(fmt);
   const AudioStreamBasicDescription* asbd=CMAudioFormatDescriptionGetStreamBasicDescription(fmt);
   if(expectedChannels && (!asbd || asbd->mChannelsPerFrame!=static_cast<UInt32>(expectedChannels)))allExpected=false;
   if(codec==QStringLiteral("eac3")){if(subtype!=kAudioFormatEnhancedAC3)allExpected=false;}
   else if(codec==QStringLiteral("aac")){
    if(subtype!=kAudioFormatMPEG4AAC || !asbd || asbd->mChannelsPerFrame<1 || asbd->mChannelsPerFrame>2)allExpected=false;
   }
#ifdef DEEPSTREAM_EXPERIMENTAL_DOLBY_VISION_AUDIO_V2
   else if(codec==QStringLiteral("ac3")){if(subtype!=kAudioFormatAC3)allExpected=false;}
   else if(codec==QStringLiteral("flac")){if(subtype!=kAudioFormatFLAC)allExpected=false;}
   else if(codec==QStringLiteral("alac")){if(subtype!=kAudioFormatAppleLossless)allExpected=false;}
#endif
  }
 }
 if(audioTracks==0 || !formatKnown)return QStringLiteral("pending");
 if(audioTracks!=1 || !enabled)return QStringLiteral("ambiguous");
 return allExpected?codec+QStringLiteral("_verified"):QStringLiteral("unsupported_codec");
}
void NativeAVBackend::monitorAuthenticatedHlsAudio(quint64 id,const QString& codec,int expectedChannels){if(id&&id==d->id){d->monitoredAudioCodec=codec;d->monitoredAudioChannels=expectedChannels;}}
#endif


void NativeAVBackend::recordFailureSnapshot(){
 d->failureState.clear();
 if(!d->id || !d->player)return;
 const qint64 pos=milliseconds(d->player.currentTime);if(pos<0)return;
 const AVPlayerTimeControlStatus current=d->player.timeControlStatus;
 bool play=false;
 if(current==AVPlayerTimeControlStatusPlaying || current==AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate) play=true;
 else if(d->lastState==QStringLiteral("paused")) play=false;
 else return; // Failure may have forced pause; the previous user intent is ambiguous.
 const float level=d->player.volume;if(!std::isfinite(level) || level<0 || level>1)return;
 d->failureState={{QStringLiteral("positionMs"),pos},{QStringLiteral("autoplay"),play},
                  {QStringLiteral("volume"),qBound(0,qRound(level*100.0f),100)},
                  {QStringLiteral("muted"),bool(d->player.muted)}};
}
QVariantMap NativeAVBackend::failureSnapshot(quint64 id)const{return id&&id==d->id?d->failureState:QVariantMap{};}

void NativeAVBackend::reset(){
 ++d->generation;d->timer.stop();
#ifdef DEEPSTREAM_HLS_CONTROLLED_MPV_TEST
 if(d->closeObserver){[[NSNotificationCenter defaultCenter] removeObserver:d->closeObserver];d->closeObserver=nil;}
 if(d->nativeView)d->nativeView.player=nil;
 if(d->nativeWindow)[d->nativeWindow close];
 d->nativeView=nil;d->nativeWindow=nil;
#endif
 if(d->endedObserver){[[NSNotificationCenter defaultCenter] removeObserver:d->endedObserver];d->endedObserver=nil;}
 if(d->failedObserver){[[NSNotificationCenter defaultCenter] removeObserver:d->failedObserver];d->failedObserver=nil;}
 if(d->player){[d->player pause];[d->player replaceCurrentItemWithPlayerItem:nil];}
 if(d->layer){d->layer.player=nil;[d->layer removeFromSuperlayer];} d->layer=nil;d->item=nil;d->player=nil;
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
 if(d->relay){d->relay->stop();d->relay.reset();}d->monitoredAudioCodec.clear();d->monitoredAudioChannels=0;d->rootObserved=false;d->accessLogBeforeRoot=0;d->rootRequestTime=nil;
#endif
 d->id=0;d->readyEmitted=false;d->videoReadyEmitted=false;d->failed=false;d->requestedRate=1000;d->lastDuration=-1;d->lastVolume=-1;d->lastMuted=false;d->lastState.clear();d->failureState.clear();
 if(d->leased){d->leased=false;auto release=d->release;if(release)release();}
}
bool NativeAVBackend::supportsTestUrl(const QUrl &url){
 if (!url.isValid() || !url.userInfo().isEmpty() || url.hasFragment()) return false;
 if (url.isLocalFile()) return !url.toLocalFile().isEmpty();
#ifdef DEEPSTREAM_LOCAL_PUBLIC_HLS_FIXTURE
 // Test-build only: anonymous, exact loopback fixture, never a Jellyfin endpoint.
 if (url.scheme() == QStringLiteral("http") && url.host() == QStringLiteral("127.0.0.1") &&
     url.port() >= 1024 && url.path() == QStringLiteral("/single-joc-master.m3u8") && !url.hasQuery()) return true;
#endif
 return url.scheme().compare(QStringLiteral("https"), Qt::CaseInsensitive) == 0 &&
     !url.host().isEmpty() && url.path().endsWith(QStringLiteral(".m3u8"), Qt::CaseInsensitive);
}
bool NativeAVBackend::open(quint64 id,const QUrl &url,bool muted){
 reset();if(!id||!supportsTestUrl(url)||!d->acquire||!d->release){emit error(id,QStringLiteral("unsupported_input_or_output_lease"));return false;}
 return openResolved(id,url,muted);
}
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
bool NativeAVBackend::openAuthorizedHls(quint64 id,const QUrl &url,const QUrl &origin,const QByteArray &authorization,bool allowLocalHttp,bool muted){
 reset();
 if(!id||!d->acquire||!d->release){emit error(id,QStringLiteral("unsupported_input_or_output_lease"));return false;}
 d->relay=std::make_unique<HlsSessionRelay>();
 connect(d->relay.get(),&HlsSessionRelay::rootPlaylistWillReload,this,[this]{
  d->accessLogBeforeRoot=d->item ? d->item.accessLog.events.count : 0;
  d->rootRequestTime=[NSDate date];
  d->rootObserved=true;
 });
 const QUrl local=d->relay->start(url,origin,authorization,allowLocalHttp);
 if(!local.isValid()){reset();emit error(id,QStringLiteral("hls_transport_unavailable"));return false;}
 return openResolved(id,local,muted);
}
#endif
bool NativeAVBackend::openResolved(quint64 id,const QUrl &url,bool muted){
 if(!d->acquire()){reset();emit error(id,QStringLiteral("output_busy"));return false;}d->leased=true;d->id=id;
 NSURL *native=url.isLocalFile() ? [NSURL fileURLWithPath:url.toLocalFile().toNSString()] : [NSURL URLWithString:url.toString(QUrl::FullyEncoded).toNSString()];
 d->item=[AVPlayerItem playerItemWithURL:native];d->player=[AVPlayer playerWithPlayerItem:d->item];
 if(!d->item||!d->player){reset();emit error(id,QStringLiteral("player_initialization_failed"));return false;}
 d->player.muted=muted;
 const quint64 gen=d->generation; QPointer<NativeAVBackend> weak(this);
 d->endedObserver=[[NSNotificationCenter defaultCenter] addObserverForName:AVPlayerItemDidPlayToEndTimeNotification object:d->item queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *) {
  if(weak && weak->d->generation==gen && weak->d->id==id)emit weak->finished(id);
 }];
 d->failedObserver=[[NSNotificationCenter defaultCenter] addObserverForName:AVPlayerItemFailedToPlayToEndTimeNotification object:d->item queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *) {
  if(weak && weak->d->generation==gen && weak->d->id==id && !weak->d->failed){weak->recordFailureSnapshot();weak->d->failed=true;[weak->d->player pause];emit weak->error(id,QStringLiteral("playback_failed"));}
 }];
 if(d->window){
#ifdef DEEPSTREAM_HLS_CONTROLLED_MPV_TEST
  NSView *qtView=(__bridge NSView *)(void *)d->window->winId();
  if(!qtView.window){reset();emit error(id,QStringLiteral("native_parent_unavailable"));return false;}
  NSRect frame=qtView.window.frame;NSRect rect=NSMakeRect(frame.origin.x+36,frame.origin.y+36,frame.size.width,frame.size.height);
  d->nativeWindow=[[NSWindow alloc] initWithContentRect:rect styleMask:(NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable) backing:NSBackingStoreBuffered defer:NO];
  d->nativeWindow.releasedWhenClosed=NO; d->nativeWindow.title=@"DeepStream Native Player Test";
  d->nativeWindow.collectionBehavior=NSWindowCollectionBehaviorFullScreenPrimary;
  d->nativeView=[[AVPlayerView alloc] initWithFrame:d->nativeWindow.contentView.bounds];
  d->nativeView.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
  d->nativeView.controlsStyle=AVPlayerViewControlsStyleFloating; d->nativeView.showsFullScreenToggleButton=YES;
  d->nativeView.player=d->player; d->nativeWindow.contentView=d->nativeView;
  d->closeObserver=[[NSNotificationCenter defaultCenter] addObserverForName:NSWindowWillCloseNotification object:d->nativeWindow queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *) {
   if(weak && weak->d->generation==gen && weak->d->id==id) QTimer::singleShot(0,weak.data(),[weak,gen,id]{if(weak && weak->d->generation==gen && weak->d->id==id) emit weak->nativeWindowClosed(id);});
  }];
  [d->nativeWindow makeKeyAndOrderFront:nil];
#else
  d->layer=[AVPlayerLayer playerLayerWithPlayer:d->player];
  d->layer.videoGravity=AVLayerVideoGravityResizeAspect;
  if(!positionVideoBelowQt(d->window,d->layer)){
   reset();emit error(id,QStringLiteral("qt_layer_parent_unavailable"));return false;
  }
#endif
 }
 d->timer.start();emit stateChanged(id,QStringLiteral("loading"));return true;
}
void NativeAVBackend::play(quint64 id){if(id&&id==d->id&&!d->failed)d->player.rate=d->requestedRate/1000.0f;}
void NativeAVBackend::pause(quint64 id){if(id&&id==d->id&&!d->failed)[d->player pause];}
void NativeAVBackend::setVolume(quint64 id,int v){if(id&&id==d->id&&d->player)d->player.volume=qBound(0,v,100)/100.0f;}
void NativeAVBackend::setMuted(quint64 id,bool v){if(id&&id==d->id&&d->player)d->player.muted=v;}
void NativeAVBackend::setRate(quint64 id,int r){if(!id||id!=d->id||!d->player||r<100||r>4000)return;d->requestedRate=r;if(d->player.rate>0)d->player.rate=r/1000.0f;}
int NativeAVBackend::volume(quint64 id)const{return id&&id==d->id&&d->player?qRound(d->player.volume*100.0f):0;}
bool NativeAVBackend::muted(quint64 id)const{return id&&id==d->id&&d->player?bool(d->player.muted):false;}

void NativeAVBackend::seek(quint64 id,qint64 ms){
 if(!id||id!=d->id||d->failed||ms<0)return;
 const quint64 gen=d->generation;QPointer<NativeAVBackend> weak(this);
 [d->player seekToTime:CMTimeMake(ms,1000) toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero completionHandler:^(BOOL finished){
  dispatch_async(dispatch_get_main_queue(), ^{if(weak&&weak->d->generation==gen&&weak->d->id==id)emit weak->seekFinished(id,ms,finished);});
 }];
}
void NativeAVBackend::close(quint64 id){if(id&&id==d->id){reset();emit stateChanged(id,QStringLiteral("stopped"));}}
void NativeAVBackend::poll(){
 const quint64 id=d->id, gen=d->generation;if(!id||!d->player||!d->item)return;
 const int volume=qBound(0,qRound(d->player.volume*100.0f),100);const bool muted=bool(d->player.muted);
 if(volume!=d->lastVolume || muted!=d->lastMuted){d->lastVolume=volume;d->lastMuted=muted;emit audioStateChanged(id,volume,muted);if(d->generation!=gen||d->id!=id)return;}
 if(d->layer && !positionVideoBelowQt(d->window,d->layer)){
  if(!d->failed){recordFailureSnapshot();d->failed=true;[d->player pause];emit error(id,QStringLiteral("qt_layer_parent_unavailable"));}return;
 }
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
 if(!d->monitoredAudioCodec.isEmpty() && authenticatedHlsAudioState(id,d->monitoredAudioCodec,d->monitoredAudioChannels)!=d->monitoredAudioCodec+QStringLiteral("_verified")){
  if(!d->failed){recordFailureSnapshot();d->failed=true;d->player.muted=YES;[d->player pause];emit error(id,QStringLiteral("native_hls_audio_changed"));}return;
 }
#endif
 if(d->item.status==AVPlayerItemStatusFailed){if(!d->failed){recordFailureSnapshot();d->failed=true;QString reason=QStringLiteral("player_item_failed");[d->player pause];emit error(id,reason);}return;}
 if(d->item.status==AVPlayerItemStatusReadyToPlay&&!d->readyEmitted){d->readyEmitted=true;emit ready(id);if(d->generation!=gen||d->id!=id)return;}
#ifdef DEEPSTREAM_HLS_CONTROLLED_MPV_TEST
 if(d->nativeView && d->nativeView.readyForDisplay && !d->videoReadyEmitted){d->videoReadyEmitted=true;emit videoReady(id);if(d->generation!=gen||d->id!=id)return;}
#else
 if(d->layer && d->layer.readyForDisplay && !d->videoReadyEmitted){d->videoReadyEmitted=true;emit videoReady(id);if(d->generation!=gen||d->id!=id)return;}
#endif
 const qint64 duration=milliseconds(d->item.duration);if(duration>=0&&duration!=d->lastDuration){d->lastDuration=duration;emit durationChanged(id,duration);if(d->generation!=gen||d->id!=id)return;}
 const qint64 pos=milliseconds(d->player.currentTime);if(pos>=0){emit positionChanged(id,pos);if(d->generation!=gen||d->id!=id)return;}
 QString state=QStringLiteral("loading"); if(d->item.status==AVPlayerItemStatusReadyToPlay) switch(d->player.timeControlStatus) {case AVPlayerTimeControlStatusPlaying: state=QStringLiteral("playing");break;case AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate: state=QStringLiteral("buffering");break;default: state=QStringLiteral("paused");}if(state!=d->lastState){d->lastState=state;emit stateChanged(id,state);}
}
