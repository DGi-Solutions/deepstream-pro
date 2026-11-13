set(MAIN_TARGET JellyfinDesktop)

# Output binary name
set(MAIN_NAME jellyfin-desktop)

# Data directory name - also used for QCoreApplication::applicationName
# which determines QStandardPaths (cache, config, data dirs)
set(DATA_NAME jellyfin-desktop)

if(APPLE)
  set(MAIN_NAME "Jellyfin Desktop")
  # Private spatial-audio build: keep its Qt settings/data separate from the
  # regular installation without changing the application/output path.
  set(DATA_NAME "DeepStream Pro")
  if(DEEPSTREAM_HLS_CONTROLLED_MPV_TEST)
    set(MAIN_NAME "DeepStream HLS Switch Test")
    set(DATA_NAME "DeepStream HLS Switch Test")
  elseif(DEEPSTREAM_EXPERIMENTAL_AV_FIXTURE)
    set(MAIN_NAME "DeepStream AV Fixture")
    set(DATA_NAME "DeepStream AV Fixture")
  endif()
elseif(WIN32)
  set(MAIN_NAME "Jellyfin Desktop")
  set(DATA_NAME "Jellyfin Desktop")
endif()

configure_file(src/shared/Names.cpp.in src/shared/Names.cpp @ONLY)
