@registro_ob2
Feature: Registro de nuevo usuario y activacion de cuenta

  @registro_completo
  Scenario: Registro exitoso con verificacion OTP por email
    Given que estoy en la página de registro de Finkargo
    When completo el formulario de datos personales con datos aleatorios
    And completo el formulario de datos de empresa
    And solicito el código de verificación
    And obtengo el código desde Maildrop
    And verifico mi cuenta con el código recibido
    Then debería ver que el registro fue exitoso
