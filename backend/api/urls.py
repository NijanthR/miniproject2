from django.urls import path

from . import views

urlpatterns = [
    path('health/', views.health_check, name='api_health_check'),
    path('chat/', views.chat, name='chat'),
    path('chat/history/', views.chat_history, name='chat_history'),
    path('community/messages/', views.community_messages, name='community_messages'),
    path('community/messages/post/', views.community_messages_post, name='community_messages_post'),
    path('community/messages/delete/', views.community_messages_delete, name='community_messages_delete'),
    path('auth/google/config/', views.google_auth_config, name='google_auth_config'),
    path('auth/google/', views.google_auth, name='google_auth'),
    path('auth/google/token/', views.google_auth_token, name='google_auth_token'),
    path('test/mcq/generate/', views.generate_mcq_test, name='generate_mcq_test'),
    path('test/coding/generate/', views.generate_coding_test, name='generate_coding_test'),
    path('test/coding/run/', views.run_coding_test, name='run_coding_test'),
]
